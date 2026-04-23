"""Build the concept graph.

Three kinds of edges are emitted into the ``edges`` table:

1. ``semantic_near`` — top-K nearest neighbors by embedding cosine similarity
   (purely automatic, used on the frontend for "related concepts").
2. ``semantic_dedup`` — pairs with cosine > DEDUP_THRESHOLD, flagged for a
   human (or a second LLM pass) to merge.
3. ``prerequisite_of`` — resolved from each concept's free-text
   ``prerequisites_raw`` list by nearest-neighbor lookup against embeddings,
   filtered by a similarity floor.
"""
from __future__ import annotations

import argparse
import json

import numpy as np
from tqdm import tqdm

from pipeline.db import connect

DEDUP_THRESHOLD = 0.92
PREREQ_MATCH_THRESHOLD = 0.72
TOP_K_SEMANTIC = 8


def _load_matrix(conn):
    rows = conn.execute(
        "SELECT id, slug, title, embedding, prerequisites_raw "
        "FROM concepts WHERE embedding IS NOT NULL AND dropped = 0 ORDER BY id"
    ).fetchall()
    ids = np.array([r["id"] for r in rows], dtype=np.int64)
    mat = np.stack(
        [np.frombuffer(r["embedding"], dtype=np.float32) for r in rows]
    )  # already L2-normalized at embed time
    meta = {r["id"]: r for r in rows}
    return ids, mat, meta


def _insert_edge(conn, src_id: int, dst_id: int, kind: str, source: str, weight: float, note: str | None = None):
    conn.execute(
        "INSERT OR IGNORE INTO edges (src_id, dst_id, kind, source, weight, note) VALUES (?, ?, ?, ?, ?, ?)",
        (src_id, dst_id, kind, source, float(weight), note),
    )


def build_semantic_edges(conn):
    ids, mat, meta = _load_matrix(conn)
    n = len(ids)
    if n == 0:
        print("no embeddings — skip semantic edges")
        return

    print(f"computing {n}x{n} similarity…")
    sims = mat @ mat.T  # cosine since vectors are normalized
    np.fill_diagonal(sims, -1.0)

    dedup_pairs: list[tuple[int, int, float]] = []
    print("writing semantic_near + semantic_dedup…")
    with tqdm(total=n, desc="edges") as bar:
        for i, sid in enumerate(ids):
            # top-K nearest neighbors
            top = np.argpartition(-sims[i], TOP_K_SEMANTIC)[:TOP_K_SEMANTIC]
            top = top[np.argsort(-sims[i, top])]
            for j in top:
                s = float(sims[i, j])
                if s <= 0:
                    continue
                _insert_edge(
                    conn, int(sid), int(ids[j]), "semantic_near", "embedding", s
                )
                if s >= DEDUP_THRESHOLD and i < j:
                    dedup_pairs.append((int(sid), int(ids[j]), s))
            bar.update(1)
    for a, b, s in dedup_pairs:
        _insert_edge(conn, a, b, "semantic_dedup", "embedding", s, f"cosine={s:.3f}")
    conn.commit()
    print(f"semantic_dedup pairs: {len(dedup_pairs)}")


def _embed_query(client, model: str, text: str) -> np.ndarray:
    resp = client.embeddings.create(model=model, input=[text])
    v = np.array(resp.data[0].embedding, dtype=np.float32)
    n = np.linalg.norm(v)
    return v / n if n else v


def build_prereq_edges(conn):
    """Resolve prerequisites_raw → concept ids via nearest neighbor over embeddings."""
    from pipeline.config import EMBED_MODEL, openai_client

    ids, mat, meta = _load_matrix(conn)
    if not len(ids):
        return

    # Collect all unique prerequisite strings and embed them in one batch.
    raw_by_src: dict[int, list[str]] = {}
    unique: set[str] = set()
    for cid, row in meta.items():
        try:
            lst = json.loads(row["prerequisites_raw"] or "[]")
        except Exception:  # noqa: BLE001
            lst = []
        lst = [s.strip() for s in lst if isinstance(s, str) and s.strip()]
        if not lst:
            continue
        raw_by_src[cid] = lst
        unique.update(lst)

    if not unique:
        print("no prerequisites_raw to resolve")
        return

    unique_list = sorted(unique)
    print(f"resolving {len(unique_list)} unique prerequisite phrases…")
    client = openai_client()
    BATCH = 96
    embs: dict[str, np.ndarray] = {}
    with tqdm(total=len(unique_list), desc="prereq-embed") as bar:
        for i in range(0, len(unique_list), BATCH):
            chunk = unique_list[i : i + BATCH]
            resp = client.embeddings.create(model=EMBED_MODEL, input=chunk)
            vecs = np.array([d.embedding for d in resp.data], dtype=np.float32)
            norms = np.linalg.norm(vecs, axis=1, keepdims=True)
            norms[norms == 0] = 1.0
            vecs = vecs / norms
            for t, v in zip(chunk, vecs, strict=True):
                embs[t] = v
            bar.update(len(chunk))

    resolved = 0
    with tqdm(total=len(raw_by_src), desc="prereq-resolve") as bar:
        for src_id, phrases in raw_by_src.items():
            for phrase in phrases:
                q = embs.get(phrase)
                if q is None:
                    continue
                sims = mat @ q
                # disallow self-match
                idx = int(np.argmax(sims))
                best_id = int(ids[idx])
                if best_id == src_id:
                    # take second-best
                    sims[idx] = -1
                    idx = int(np.argmax(sims))
                    best_id = int(ids[idx])
                score = float(sims[idx])
                if score < PREREQ_MATCH_THRESHOLD:
                    continue
                _insert_edge(
                    conn,
                    best_id,  # src = prerequisite, dst = concept that needs it
                    src_id,
                    "prerequisite_of",
                    "prereq-resolve",
                    score,
                    f'raw="{phrase}"',
                )
                resolved += 1
            bar.update(1)
    conn.commit()
    print(f"prerequisite edges resolved: {resolved}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-prereq", action="store_true")
    args = ap.parse_args(argv)

    conn = connect()
    # Wipe auto-generated edges to keep reruns idempotent.
    conn.execute(
        "DELETE FROM edges WHERE source IN ('embedding', 'prereq-resolve')"
    )
    conn.commit()

    build_semantic_edges(conn)
    if not args.skip_prereq:
        build_prereq_edges(conn)

    n = conn.execute("SELECT COUNT(*) n FROM edges").fetchone()["n"]
    print(f"total edges: {n}")
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
