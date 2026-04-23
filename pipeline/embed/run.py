"""Embed every kept concept with OpenAI's text-embedding-3-small."""
from __future__ import annotations

import argparse
import datetime as _dt
import sys
from datetime import timezone

import numpy as np
from tenacity import retry, stop_after_attempt, wait_exponential
from tqdm import tqdm

from pipeline.config import EMBED_MODEL, openai_client
from pipeline.db import connect

BATCH = 96  # OpenAI accepts up to 2048 inputs per call; 96 keeps individual calls snappy

EMBED_DIMS = 1536  # for text-embedding-3-small


def _text_for(row) -> str:
    parts = [row["title"]]
    if row["one_liner"]:
        parts.append(row["one_liner"])
    if row["aha_explanation"]:
        parts.append(row["aha_explanation"])
    return "\n".join(p for p in parts if p)


@retry(stop=stop_after_attempt(4), wait=wait_exponential(min=1, max=10))
def _embed_batch(client, texts: list[str]) -> np.ndarray:
    resp = client.embeddings.create(model=EMBED_MODEL, input=texts)
    vecs = np.array([d.embedding for d in resp.data], dtype=np.float32)
    # normalize for cosine = dot
    norms = np.linalg.norm(vecs, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return vecs / norms


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="Re-embed everything")
    args = ap.parse_args(argv)

    conn = connect()
    q = """
        SELECT id, title, one_liner, aha_explanation
          FROM concepts
         WHERE dropped = 0 AND enriched_at IS NOT NULL
    """
    if not args.force:
        q += " AND (embedding IS NULL OR embedding_model != ?)"
        rows = conn.execute(q, (EMBED_MODEL,)).fetchall()
    else:
        rows = conn.execute(q).fetchall()

    if not rows:
        print("nothing to embed")
        return 0

    print(f"embedding {len(rows)} concepts with {EMBED_MODEL}")
    client = openai_client()
    now = _dt.datetime.now(timezone.utc).isoformat()

    with tqdm(total=len(rows), desc="embed", unit="c") as bar:
        for i in range(0, len(rows), BATCH):
            batch = rows[i : i + BATCH]
            texts = [_text_for(r) for r in batch]
            try:
                vecs = _embed_batch(client, texts)
            except Exception as e:  # noqa: BLE001
                print(f"[embed] batch {i}: {e}", file=sys.stderr)
                bar.update(len(batch))
                continue
            for r, v in zip(batch, vecs, strict=True):
                conn.execute(
                    "UPDATE concepts SET embedding=?, embedding_model=?, embedded_at=? WHERE id=?",
                    (v.tobytes(), EMBED_MODEL, now, r["id"]),
                )
            conn.commit()
            bar.update(len(batch))

    done = conn.execute(
        "SELECT COUNT(*) AS n FROM concepts WHERE embedding IS NOT NULL AND embedding_model = ?",
        (EMBED_MODEL,),
    ).fetchone()
    print(f"embedded: {done['n']}")
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
