"""Collect notable quotes for each concept.

Strategy per concept:
  1. Try Wikiquote with the concept's title. If it returns ≥1 quote, take up
     to N and tag source='wikiquote'.
  2. Otherwise ask the LLM for 2-3 famous quotes, then verify each by
     phrase-searching Wikipedia + Wikiquote. Keep verified quotes only,
     tagged source='llm_verified'.

Results land in the `quotes` table (one row per quote). The cache table
stores the raw scrape/LLM output keyed by concept slug + step, so re-runs
skip the network.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass

from tqdm import tqdm

from pipeline.config import openai_client
from pipeline.db import connect
from pipeline.quotes import llm as llm_mod
from pipeline.quotes import wikiquote as wq

MAX_PER_CONCEPT = 3


@dataclass
class StoredQuote:
    text: str
    attribution: str
    source: str  # 'wikiquote' | 'llm_verified'
    source_url: str


def _cache_get(conn, key: str):
    row = conn.execute("SELECT value FROM cache WHERE key = ?", (key,)).fetchone()
    return json.loads(row["value"]) if row else None


def _cache_put(conn, key: str, value) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO cache (key, value) VALUES (?, ?)",
        (key, json.dumps(value)),
    )


def _has_quotes(conn, concept_id: int) -> bool:
    row = conn.execute("SELECT 1 FROM quotes WHERE concept_id = ? LIMIT 1", (concept_id,)).fetchone()
    return row is not None


def _store(conn, concept_id: int, qs: list[StoredQuote]) -> None:
    for rank, q in enumerate(qs):
        conn.execute(
            """
            INSERT OR IGNORE INTO quotes
                (concept_id, text, attribution, source, source_url, rank)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (concept_id, q.text, q.attribution, q.source, q.source_url, rank),
        )


def _try_wikiquote(conn, slug: str, title: str) -> list[StoredQuote]:
    cache_key = f"quotes:wq:{slug}"
    cached = _cache_get(conn, cache_key)
    if cached is not None:
        items = cached
    else:
        raw = wq.fetch_quotes(title, max_quotes=MAX_PER_CONCEPT * 2)
        items = [asdict(q) for q in raw]
        _cache_put(conn, cache_key, items)
    out: list[StoredQuote] = []
    for it in items[:MAX_PER_CONCEPT]:
        out.append(
            StoredQuote(
                text=it["text"],
                attribution=it.get("attribution", ""),
                source="wikiquote",
                source_url=it.get("source_url", ""),
            )
        )
    return out


def _try_llm(conn, client, slug: str, title: str, one_liner: str, extract: str) -> list[StoredQuote]:
    cache_key = f"quotes:llm:{slug}"
    cached = _cache_get(conn, cache_key)
    if cached is not None:
        suggestions = [llm_mod._LlmQuote.model_validate(x) for x in cached]
    else:
        suggestions = llm_mod.suggest_quotes(client, title, one_liner, extract)
        _cache_put(conn, cache_key, [s.model_dump() for s in suggestions])

    verified: list[StoredQuote] = []
    for s in suggestions:
        if not s.text or len(s.text) < 20:
            continue
        # Verifier results cached separately so we never re-search the same
        # text twice across re-runs.
        vk = f"quotes:verify:{hash((s.text,))}"
        vcached = _cache_get(conn, vk)
        if vcached is not None:
            hit = vcached if vcached else None
        else:
            hit_obj = llm_mod.verify_quote(s.text)
            hit = {"site": hit_obj.site, "page_title": hit_obj.page_title} if hit_obj is not None else None
            _cache_put(conn, vk, hit if hit is not None else {})
            # Re-fetch to normalize: empty dict means "checked, no hit".
            if not hit:
                hit = None
        if hit is None:
            continue
        verified.append(
            StoredQuote(
                text=s.text,
                attribution=llm_mod.format_attribution(s),
                source="llm_verified",
                source_url=f"https://{hit['site']}/wiki/{hit['page_title'].replace(' ', '_')}",
            )
        )
        if len(verified) >= MAX_PER_CONCEPT:
            break
    return verified


def _process(conn, client, row, llm_enabled: bool) -> tuple[int, int, str]:
    """Return (concept_id, quotes_added, source_used)."""
    concept_id = row["id"]
    slug = row["slug"]
    title = row["title"]

    quotes = _try_wikiquote(conn, slug, title)
    used = "wikiquote"
    if not quotes and llm_enabled:
        quotes = _try_llm(conn, client, slug, title, row["one_liner"] or "", row["wiki_extract"] or "")
        used = "llm" if quotes else "none"
    elif not quotes:
        used = "none"

    if quotes:
        _store(conn, concept_id, quotes)
    return concept_id, len(quotes), used


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None, help="max concepts to process")
    ap.add_argument("--force", action="store_true", help="re-fetch even if quotes already exist")
    ap.add_argument("--no-llm", action="store_true", help="skip the LLM fallback (Wikiquote-only)")
    ap.add_argument("--workers", type=int, default=8, help="parallel Wikiquote fetchers")
    args = ap.parse_args(argv)

    conn = connect()
    rows = conn.execute(
        """
        SELECT id, slug, title, one_liner, wiki_extract
          FROM concepts
         WHERE dropped = 0 AND enriched_at IS NOT NULL
         ORDER BY id
        """
    ).fetchall()
    if args.limit:
        rows = rows[: args.limit]

    if not args.force:
        rows = [r for r in rows if not _has_quotes(conn, r["id"])]

    if not rows:
        print("nothing to do — all concepts have quotes (use --force to re-fetch)")
        return 0

    print(f"fetching quotes for {len(rows)} concepts (llm fallback: {'off' if args.no_llm else 'on'})")
    client = None if args.no_llm else openai_client()

    # SQLite is single-threaded; Wikiquote requests are throttled to 10 rps
    # globally anyway, so a sequential pass is the simplest correct thing.
    counts = {"wikiquote": 0, "llm": 0, "none": 0}
    with tqdm(total=len(rows), desc="quotes", unit="c") as bar:
        for r in rows:
            cid = r["id"]
            qs = _try_wikiquote(conn, r["slug"], r["title"])
            used = "wikiquote" if qs else "none"
            if not qs and not args.no_llm:
                qs = _try_llm(conn, client, r["slug"], r["title"], r["one_liner"] or "", r["wiki_extract"] or "")
                used = "llm" if qs else "none"
            if qs:
                _store(conn, cid, qs)
            counts[used] += 1
            conn.commit()
            bar.update(1)
            bar.set_postfix(**counts)

    total_q = conn.execute("SELECT COUNT(*) AS n FROM quotes").fetchone()["n"]
    by_src = conn.execute("SELECT source, COUNT(*) AS n FROM quotes GROUP BY source").fetchall()
    print(f"\ndone. concepts processed: wikiquote={counts['wikiquote']}  llm={counts['llm']}  none={counts['none']}")
    print(f"total quotes in db: {total_q}")
    for r in by_src:
        print(f"  {r['source']}: {r['n']}")
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
