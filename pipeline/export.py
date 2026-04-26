"""Export SQLite → JSON/binary artifacts consumed by the Next.js frontend.

Writes into ``web/public/data/``:
- ``concepts.json``  — core record per concept (no embeddings)
- ``embeddings.bin`` — packed Float32 matrix (N × DIM), L2-normalized
- ``embeddings_meta.json`` — { ids: [cid...], dim: int, model: str }
- ``edges.json``     — adjacency grouped by concept id
- ``tags.json``      — pre-aggregated facet counts for the browse UI
- ``search.json``    — tiny document shape for client-side MiniSearch index
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

from pipeline.db import connect

OUT_DIR = Path(__file__).resolve().parent.parent / "web" / "public" / "data"


def _jloads(s: str | None, default):
    if not s:
        return default
    try:
        return json.loads(s)
    except Exception:  # noqa: BLE001
        return default


def export() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    conn = connect()

    rows = conn.execute(
        """
        SELECT id, slug, title, source_list, wiki_url, wiki_extract,
               one_liner, aha_explanation, canonical_example,
               domain, form, affect, obscurity, surprise_score,
               prerequisites_raw, embedding, embedding_model
          FROM concepts
         WHERE dropped = 0 AND enriched_at IS NOT NULL
         ORDER BY id
        """
    ).fetchall()

    concepts = []
    emb_ids: list[int] = []
    emb_vecs: list[np.ndarray] = []
    model = None
    for r in rows:
        c = {
            "id": r["id"],
            "slug": r["slug"],
            "title": r["title"],
            "source": r["source_list"],
            "wikiUrl": r["wiki_url"],
            "oneLiner": r["one_liner"] or "",
            "aha": r["aha_explanation"] or "",
            "example": r["canonical_example"] or "",
            "domain": _jloads(r["domain"], []),
            "form": r["form"] or "concept",
            "affect": _jloads(r["affect"], []),
            "obscurity": r["obscurity"] or 3,
            "surprise": r["surprise_score"] or 5,
        }
        concepts.append(c)
        if r["embedding"] is not None:
            emb_ids.append(r["id"])
            emb_vecs.append(np.frombuffer(r["embedding"], dtype=np.float32))
            model = r["embedding_model"]

    # --- concepts.json
    (OUT_DIR / "concepts.json").write_text(json.dumps(concepts, separators=(",", ":"), ensure_ascii=False))

    # --- embeddings
    if emb_vecs:
        mat = np.stack(emb_vecs).astype(np.float32)
        (OUT_DIR / "embeddings.bin").write_bytes(mat.tobytes())
        (OUT_DIR / "embeddings_meta.json").write_text(
            json.dumps(
                {"ids": emb_ids, "dim": int(mat.shape[1]), "model": model},
                separators=(",", ":"),
            )
        )
    else:
        # still emit empty files so the frontend fetch succeeds
        (OUT_DIR / "embeddings.bin").write_bytes(b"")
        (OUT_DIR / "embeddings_meta.json").write_text(json.dumps({"ids": [], "dim": 0, "model": None}))

    # --- edges.json, grouped by src for quick lookup, kind → [{dstId, weight}]
    edges = conn.execute("SELECT src_id, dst_id, kind, weight FROM edges ORDER BY src_id, kind, weight DESC").fetchall()
    kept_ids = {c["id"] for c in concepts}
    out_edges: dict[int, dict[str, list[dict]]] = defaultdict(lambda: defaultdict(list))
    for e in edges:
        if e["src_id"] not in kept_ids or e["dst_id"] not in kept_ids:
            continue
        out_edges[e["src_id"]][e["kind"]].append({"id": e["dst_id"], "w": round(float(e["weight"]), 4)})
    (OUT_DIR / "edges.json").write_text(json.dumps(out_edges, separators=(",", ":")))

    # --- tags.json: facet counts
    domain_counts = Counter()
    form_counts = Counter()
    affect_counts = Counter()
    source_counts = Counter()
    obscurity_counts = Counter()
    for c in concepts:
        for d in c["domain"]:
            domain_counts[d] += 1
        form_counts[c["form"]] += 1
        for a in c["affect"]:
            affect_counts[a] += 1
        source_counts[c["source"]] += 1
        obscurity_counts[c["obscurity"]] += 1
    (OUT_DIR / "tags.json").write_text(
        json.dumps(
            {
                "domain": sorted(domain_counts.items(), key=lambda x: -x[1]),
                "form": sorted(form_counts.items(), key=lambda x: -x[1]),
                "affect": sorted(affect_counts.items(), key=lambda x: -x[1]),
                "source": sorted(source_counts.items(), key=lambda x: -x[1]),
                "obscurity": sorted(obscurity_counts.items()),
                "total": len(concepts),
            },
            separators=(",", ":"),
        )
    )

    # --- search.json: small per-concept docs for MiniSearch on the client
    search_docs = [
        {
            "id": c["id"],
            "slug": c["slug"],
            "title": c["title"],
            "oneLiner": c["oneLiner"],
            "aha": c["aha"],
        }
        for c in concepts
    ]
    (OUT_DIR / "search.json").write_text(json.dumps(search_docs, separators=(",", ":"), ensure_ascii=False))

    print(
        f"exported → {OUT_DIR}\n"
        f"  concepts: {len(concepts)}   embeddings: {len(emb_ids)}   "
        f"edges: {sum(len(v) for d in out_edges.values() for v in d.values())}"
    )
    conn.close()


if __name__ == "__main__":
    export()
