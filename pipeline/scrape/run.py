"""Main scraper entry point. Populates the concepts table from Tier 1 lists."""
from __future__ import annotations

import datetime as _dt
import sys
from datetime import timezone

from tqdm import tqdm

from pipeline.db import connect
from pipeline.scrape.extract import extract_entries
from pipeline.scrape.sources import MANUAL_SOURCES, SOURCES, ManualSource, Source
from pipeline.scrape.wiki import fetch_page_html, fetch_summaries
from pipeline.util import slugify


def _insert_manual_seeds(conn, source: ManualSource) -> int:
    now = _dt.datetime.now(timezone.utc).isoformat()
    inserted = 0
    cur = conn.cursor()
    for title in source.titles:
        slug = slugify(title)
        cur.execute(
            """
            INSERT OR IGNORE INTO concepts
                (slug, title, source_list, wiki_url, wiki_fetched_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                slug,
                title,
                source.key,
                f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}",
                now,
            ),
        )
        if cur.rowcount:
            inserted += 1
    conn.commit()
    return inserted


def _insert_seeds(conn, source: Source, titles: list[str]) -> int:
    """Insert rows for each title; skip ones that already exist for this source."""
    now = _dt.datetime.now(timezone.utc).isoformat()
    inserted = 0
    cur = conn.cursor()
    for title in titles:
        slug = slugify(title)
        cur.execute(
            """
            INSERT OR IGNORE INTO concepts
                (slug, title, source_list, wiki_url, wiki_fetched_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                slug,
                title,
                source.key,
                f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}",
                now,
            ),
        )
        if cur.rowcount:
            inserted += 1
    conn.commit()
    return inserted


def _enrich_extracts(conn) -> int:
    """Fetch intro extracts for any concepts that don't have one yet."""
    cur = conn.cursor()
    rows = cur.execute(
        "SELECT id, title FROM concepts WHERE wiki_extract IS NULL OR wiki_extract = ''"
    ).fetchall()
    if not rows:
        return 0
    by_title = {r["title"]: r["id"] for r in rows}
    titles = list(by_title)
    updated = 0
    with tqdm(total=len(titles), desc="extracts", unit="pg") as bar:
        for i in range(0, len(titles), 20):
            chunk = titles[i : i + 20]
            summaries = fetch_summaries(chunk)
            # summaries is keyed by every alias that resolved, so our original
            # stored title will be present directly.
            for alias, payload in summaries.items():
                cid = by_title.get(alias)
                if cid is None:
                    continue
                cur.execute(
                    """
                    UPDATE concepts
                       SET wiki_extract = ?,
                           wiki_pageid  = ?,
                           wiki_url     = COALESCE(NULLIF(?, ''), wiki_url)
                     WHERE id = ?
                    """,
                    (
                        payload.get("extract") or "",
                        payload.get("pageid"),
                        payload.get("canonicalurl") or "",
                        cid,
                    ),
                )
                updated += 1
            conn.commit()
            bar.update(len(chunk))
    return updated


def main() -> int:
    conn = connect()
    total_seeds = 0
    for src in SOURCES:
        try:
            html = fetch_page_html(src.page)
        except Exception as e:  # noqa: BLE001
            print(f"[warn] failed to fetch {src.page!r}: {e}", file=sys.stderr)
            continue
        entries = extract_entries(html, exclude_sections=src.exclude_sections)
        titles = [t for t, _ in entries]
        inserted = _insert_seeds(conn, src, titles)
        print(f"  {src.key:<24s} {len(titles):>5d} found   {inserted:>5d} new")
        total_seeds += inserted
    for msrc in MANUAL_SOURCES:
        inserted = _insert_manual_seeds(conn, msrc)
        print(f"  {msrc.key:<24s} {len(msrc.titles):>5d} curated  {inserted:>5d} new")
        total_seeds += inserted
    print(f"total new seeds: {total_seeds}")

    print("fetching intro extracts…")
    updated = _enrich_extracts(conn)
    print(f"extracts updated: {updated}")

    # Final stats
    row = conn.execute(
        "SELECT COUNT(*) AS n, "
        "SUM(CASE WHEN wiki_extract IS NOT NULL AND wiki_extract != '' THEN 1 ELSE 0 END) AS with_extract "
        "FROM concepts"
    ).fetchone()
    print(f"concepts total: {row['n']}  with extract: {row['with_extract']}")
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
