"""Cluster the corpus by embedding and write ``clusters.json``.

Pure-numpy k-means with k-means++ init. Each cluster also gets a small set of
representatives (concepts closest to its centroid) and a list of distinctive
terms drawn from member titles + one-liners (term frequency in the cluster
divided by global frequency, to surface what's *characteristic* of the
cluster rather than what's just common everywhere).

Output shape (``web/public/data/clusters.json``):

  {
    "k": 40,
    "clusters": [
      { "id": 0, "size": 73, "representatives": [cid, ...], "topTerms": [...] },
      ...
    ],
    "assignments": { "<conceptId>": clusterId, ... }
  }
"""

from __future__ import annotations

import argparse
import json
import math
import re
from collections import Counter
from pathlib import Path

import numpy as np

from pipeline.db import connect

OUT_PATH = Path(__file__).resolve().parents[2] / "web" / "public" / "data" / "clusters.json"

STOPWORDS = {
    "the",
    "a",
    "an",
    "of",
    "in",
    "on",
    "at",
    "to",
    "for",
    "and",
    "or",
    "but",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "as",
    "by",
    "with",
    "that",
    "this",
    "it",
    "its",
    "from",
    "into",
    "than",
    "then",
    "so",
    "if",
    "not",
    "no",
    "do",
    "does",
    "did",
    "have",
    "has",
    "had",
    "can",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "we",
    "you",
    "i",
    "they",
    "he",
    "she",
    "his",
    "her",
    "their",
    "our",
    "your",
    "my",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "more",
    "less",
    "most",
    "least",
    "such",
    "very",
    "much",
    "also",
    "other",
    "another",
    "some",
    "any",
    "all",
    "each",
    "every",
    "many",
    "few",
    "thing",
    "things",
    "way",
    "ways",
    "kind",
    "type",
    "form",
    "concept",
    "term",
    "idea",
    "person",
    "people",
    "make",
    "makes",
    "made",
    "use",
    "used",
    "using",
    "call",
    "called",
    "calls",
    "see",
    "seen",
    "say",
    "said",
    "says",
    "find",
    "found",
    "give",
    "given",
    "gives",
    "set",
    "sets",
    "get",
    "gets",
    "got",
}

WORD_RE = re.compile(r"[a-zA-Z][a-zA-Z'-]+")


def _load_embeddings(conn):
    rows = conn.execute(
        "SELECT id, slug, title, one_liner, embedding "
        "FROM concepts WHERE embedding IS NOT NULL AND dropped = 0 ORDER BY id"
    ).fetchall()
    ids = np.array([r["id"] for r in rows], dtype=np.int64)
    mat = np.stack([np.frombuffer(r["embedding"], dtype=np.float32) for r in rows])
    text_by_id = {r["id"]: f"{r['title'] or ''} {r['one_liner'] or ''}".lower() for r in rows}
    return ids, mat, text_by_id


def _kmeans_pp_init(mat: np.ndarray, k: int, rng: np.random.Generator) -> np.ndarray:
    """Pick k initial centroids with the k-means++ heuristic."""
    n = mat.shape[0]
    first = rng.integers(0, n)
    centers = [mat[first]]
    # We work on cosine distances since vectors are L2-normalized. Clamp to
    # ≥0 because tiny float noise can take 1 − sim slightly negative.
    closest = np.maximum(0.0, 1.0 - mat @ centers[0])
    for _ in range(1, k):
        total = closest.sum()
        probs = closest / total if total > 0 else None
        idx = rng.choice(n, p=probs) if probs is not None else rng.integers(0, n)
        centers.append(mat[idx])
        new_d = np.maximum(0.0, 1.0 - mat @ centers[-1])
        closest = np.minimum(closest, new_d)
    return np.stack(centers)


def kmeans(mat: np.ndarray, k: int, iters: int = 30, seed: int = 7) -> tuple[np.ndarray, np.ndarray]:
    """Spherical k-means: assign by cosine, recompute centroid, re-normalize."""
    rng = np.random.default_rng(seed)
    centers = _kmeans_pp_init(mat, k, rng)
    centers = centers / (np.linalg.norm(centers, axis=1, keepdims=True) + 1e-9)
    labels = np.zeros(mat.shape[0], dtype=np.int32)
    for it in range(iters):
        sims = mat @ centers.T  # n × k
        new_labels = np.argmax(sims, axis=1).astype(np.int32)
        if it > 0 and np.array_equal(new_labels, labels):
            break
        labels = new_labels
        for ci in range(k):
            members = mat[labels == ci]
            if len(members) == 0:
                # Reinitialize empty clusters from a random point.
                centers[ci] = mat[rng.integers(0, mat.shape[0])]
            else:
                m = members.mean(axis=0)
                n = np.linalg.norm(m)
                centers[ci] = m / n if n else m
    return labels, centers


def top_terms(text_by_id: dict[int, str], member_ids: list[int], all_ids: list[int], top_n: int = 6) -> list[str]:
    """Term frequency in cluster ÷ term frequency in corpus."""
    cluster_counts: Counter[str] = Counter()
    global_counts: Counter[str] = Counter()
    member_set = set(member_ids)
    for cid in all_ids:
        text = text_by_id.get(cid, "")
        words = [w.lower() for w in WORD_RE.findall(text) if len(w) > 2]
        words = [w for w in words if w not in STOPWORDS]
        for w in words:
            global_counts[w] += 1
        if cid in member_set:
            for w in words:
                cluster_counts[w] += 1

    n_members = max(1, len(member_ids))
    n_total = len(all_ids)
    scores: list[tuple[str, float]] = []
    for term, cf in cluster_counts.items():
        if cf < 2:
            continue
        gf = global_counts[term]
        # Distinctiveness: cluster prevalence × log(idf-ish). Damp very common
        # words by their global rate.
        cluster_rate = cf / n_members
        global_rate = gf / n_total
        if global_rate <= 0:
            continue
        score = cluster_rate * math.log(1 + cluster_rate / global_rate)
        scores.append((term, score))
    scores.sort(key=lambda x: -x[1])
    return [t for t, _ in scores[:top_n]]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--k", type=int, default=None, help="number of clusters (default: round(sqrt(N/2)))")
    ap.add_argument("--reps", type=int, default=6, help="representatives per cluster")
    ap.add_argument("--terms", type=int, default=6, help="top distinctive terms per cluster")
    ap.add_argument("--iters", type=int, default=30)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args(argv)

    conn = connect()
    ids, mat, text_by_id = _load_embeddings(conn)
    n = len(ids)
    if n == 0:
        print("no embeddings — skip clustering")
        return 0

    k = args.k or max(8, round(math.sqrt(n / 2)))
    print(f"clustering N={n} into k={k}…")
    labels, centers = kmeans(mat, k, iters=args.iters, seed=args.seed)

    clusters: list[dict] = []
    assignments: dict[str, int] = {}
    all_ids_list = ids.tolist()
    for ci in range(k):
        member_idx = np.where(labels == ci)[0]
        if len(member_idx) == 0:
            continue
        member_ids = ids[member_idx].tolist()
        # closest to centroid
        sims = mat[member_idx] @ centers[ci]
        order = np.argsort(-sims)
        reps = [int(ids[member_idx[i]]) for i in order[: args.reps]]
        terms = top_terms(text_by_id, member_ids, all_ids_list, top_n=args.terms)
        clusters.append(
            {
                "id": ci,
                "size": len(member_ids),
                "representatives": reps,
                "topTerms": terms,
            }
        )
    for cid, label in zip(ids.tolist(), labels.tolist(), strict=True):
        assignments[str(int(cid))] = int(label)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(
            {"k": k, "clusters": clusters, "assignments": assignments},
            separators=(",", ":"),
        )
    )
    print(
        f"wrote {OUT_PATH}  ({len(clusters)} clusters, sizes "
        f"min={min(c['size'] for c in clusters)} "
        f"max={max(c['size'] for c in clusters)} "
        f"mean={sum(c['size'] for c in clusters) / len(clusters):.1f})"
    )
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
