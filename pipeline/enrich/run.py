"""Enrichment pipeline. One LLM call per concept, result cached by content hash."""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import timezone

from pydantic import ValidationError
from tenacity import retry, stop_after_attempt, wait_exponential
from tqdm import tqdm

from pipeline.config import ENRICH_MODEL, openai_client
from pipeline.db import connect
from pipeline.enrich.prompt import SYSTEM, user_message
from pipeline.enrich.schema import Enriched
from pipeline.util import content_hash

SURPRISE_DROP_THRESHOLD = 4  # keep anything >= this


def _now() -> str:
    return _dt.datetime.now(timezone.utc).isoformat()


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def _call(client, title: str, source: str, extract: str) -> Enriched:
    # Structured outputs: pass the Pydantic model; the API constrains the
    # response to exactly match the schema (enums included).
    resp = client.chat.completions.parse(
        model=ENRICH_MODEL,
        temperature=0.4,
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": user_message(title, source, extract)},
        ],
        response_format=Enriched,
    )
    parsed = resp.choices[0].message.parsed
    if parsed is None:
        raise RuntimeError(f"no parsed output: {resp.choices[0].message.refusal!r}")
    return parsed


def _upsert(conn, cid: int, enriched: Enriched, chash: str) -> None:
    drop = 1 if enriched.surprise_score < SURPRISE_DROP_THRESHOLD else 0
    drop_reason = "low_surprise" if drop else None
    conn.execute(
        """
        UPDATE concepts SET
            one_liner = ?,
            aha_explanation = ?,
            canonical_example = ?,
            domain = ?,
            form = ?,
            affect = ?,
            obscurity = ?,
            prerequisites_raw = ?,
            surprise_score = ?,
            enriched_at = ?,
            enrich_model = ?,
            content_hash = ?,
            dropped = ?,
            drop_reason = ?
        WHERE id = ?
        """,
        (
            enriched.one_liner,
            enriched.aha_explanation,
            enriched.canonical_example,
            json.dumps(enriched.domain),
            enriched.form,
            json.dumps(enriched.affect),
            enriched.obscurity,
            json.dumps(enriched.prerequisites_raw),
            enriched.surprise_score,
            _now(),
            ENRICH_MODEL,
            chash,
            drop,
            drop_reason,
            cid,
        ),
    )


def _cache_get(conn, key: str) -> dict | None:
    row = conn.execute("SELECT value FROM cache WHERE key = ?", (key,)).fetchone()
    return json.loads(row["value"]) if row else None


def _cache_put(conn, key: str, value: dict) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO cache (key, value) VALUES (?, ?)",
        (key, json.dumps(value)),
    )


def _iter_todo(conn, limit: int | None, force: bool):
    q = "SELECT id, title, source_list, wiki_extract, content_hash FROM concepts"
    if not force:
        q += " WHERE enriched_at IS NULL OR enriched_at = ''"
    q += " ORDER BY id"
    if limit:
        q += f" LIMIT {int(limit)}"
    yield from conn.execute(q).fetchall()


def _process(client, row) -> tuple[int, Enriched | None, str, Exception | None, bool]:
    """Return (concept_id, enriched | None, content_hash, error | None, from_cache)."""
    title = row["title"]
    extract = row["wiki_extract"] or ""
    chash = content_hash(title, extract[:3000])
    # Cache lookup happens on the main thread to keep sqlite single-threaded.
    try:
        enriched = _call(client, title, row["source_list"], extract)
        return row["id"], enriched, chash, None, False
    except Exception as e:  # noqa: BLE001
        return row["id"], None, chash, e, False


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None, help="Max concepts to enrich")
    ap.add_argument("--force", action="store_true", help="Re-enrich even if cached")
    ap.add_argument("--dry-run", action="store_true", help="Print cost estimate only")
    ap.add_argument("--workers", type=int, default=16, help="Parallel API workers")
    args = ap.parse_args(argv)

    conn = connect()
    todo = list(_iter_todo(conn, args.limit, args.force))
    if not todo:
        print("nothing to enrich")
        return 0

    # Rough cost estimate for gpt-4o-mini: ~400 tokens in + ~300 out per call.
    est_calls = len(todo)
    est_cost = est_calls * (400 * 0.15 + 300 * 0.60) / 1_000_000
    print(f"concepts to enrich: {est_calls}  est cost (gpt-4o-mini): ~${est_cost:.2f}")
    if args.dry_run:
        return 0

    client = openai_client()

    # Pre-filter cache hits on the main thread (sqlite).
    hits: list[tuple[int, Enriched, str]] = []
    misses = []
    for row in todo:
        title = row["title"]
        extract = row["wiki_extract"] or ""
        chash = content_hash(title, extract[:3000])
        cached = None
        if not args.force:
            cached = _cache_get(conn, f"enrich:{ENRICH_MODEL}:{chash}")
        if cached is not None:
            try:
                hits.append((row["id"], Enriched.model_validate(cached), chash))
                continue
            except ValidationError:
                pass
        misses.append(row)

    for cid, enriched, chash in hits:
        _upsert(conn, cid, enriched, chash)
    conn.commit()

    errs = 0
    print(f"cache hits: {len(hits)}   API calls: {len(misses)}")
    if not misses:
        _print_summary(conn, errs=0, cache_hits=len(hits))
        conn.close()
        return 0

    with tqdm(total=len(misses), desc="enrich", unit="c") as bar:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = {pool.submit(_process, client, row): row for row in misses}
            for fut in as_completed(futures):
                cid, enriched, chash, err, _ = fut.result()
                if err is not None or enriched is None:
                    errs += 1
                    title = futures[fut]["title"]
                    print(f"[call] {title}: {err}", file=sys.stderr)
                else:
                    _cache_put(conn, f"enrich:{ENRICH_MODEL}:{chash}", enriched.model_dump())
                    _upsert(conn, cid, enriched, chash)
                    conn.commit()
                bar.update(1)
                bar.set_postfix(err=errs)

    _print_summary(conn, errs=errs, cache_hits=len(hits))

    conn.close()
    return 0


def _print_summary(conn, *, errs: int, cache_hits: int) -> None:
    total_row = conn.execute("SELECT COUNT(*) AS n FROM concepts WHERE enriched_at IS NOT NULL").fetchone()
    kept = conn.execute("SELECT COUNT(*) AS n FROM concepts WHERE enriched_at IS NOT NULL AND dropped = 0").fetchone()
    dropped = conn.execute("SELECT COUNT(*) AS n FROM concepts WHERE dropped = 1").fetchone()
    print(
        f"enriched total: {total_row['n']}  kept: {kept['n']}  "
        f"dropped (low surprise): {dropped['n']}  errors: {errs}  cache hits: {cache_hits}"
    )


if __name__ == "__main__":
    raise SystemExit(main())
