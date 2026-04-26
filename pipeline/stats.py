"""Quick stats on the pipeline DB."""

from __future__ import annotations

import json
from collections import Counter

from pipeline.db import connect


def main() -> int:
    conn = connect()
    total = conn.execute("SELECT COUNT(*) n FROM concepts").fetchone()["n"]
    enriched = conn.execute("SELECT COUNT(*) n FROM concepts WHERE enriched_at IS NOT NULL").fetchone()["n"]
    kept = conn.execute("SELECT COUNT(*) n FROM concepts WHERE enriched_at IS NOT NULL AND dropped = 0").fetchone()["n"]
    dropped = conn.execute("SELECT COUNT(*) n FROM concepts WHERE dropped = 1").fetchone()["n"]
    embedded = conn.execute("SELECT COUNT(*) n FROM concepts WHERE embedding IS NOT NULL").fetchone()["n"]
    edges = conn.execute("SELECT kind, COUNT(*) n FROM edges GROUP BY kind").fetchall()

    print(f"concepts:  {total}")
    print(f"enriched:  {enriched}")
    print(f"kept:      {kept}")
    print(f"dropped:   {dropped}")
    print(f"embedded:  {embedded}")
    print("edges by kind:")
    for r in edges:
        print(f"  {r['kind']:<36s} {r['n']}")

    print("\nsurprise distribution (kept):")
    rows = conn.execute(
        "SELECT surprise_score, COUNT(*) n FROM concepts WHERE dropped = 0 AND enriched_at IS NOT NULL "
        "GROUP BY surprise_score ORDER BY surprise_score"
    ).fetchall()
    for r in rows:
        bar = "█" * min(40, r["n"] // 5)
        print(f"  {r['surprise_score']:>2d}  {bar} {r['n']}")

    print("\nforms:")
    for r in conn.execute(
        "SELECT form, COUNT(*) n FROM concepts WHERE dropped = 0 AND enriched_at IS NOT NULL "
        "GROUP BY form ORDER BY n DESC"
    ):
        print(f"  {(r['form'] or '—'):<22s} {r['n']}")

    print("\ntop domains:")
    dc: Counter[str] = Counter()
    for r in conn.execute("SELECT domain FROM concepts WHERE dropped = 0 AND domain IS NOT NULL"):
        try:
            for d in json.loads(r["domain"]):
                dc[d] += 1
        except Exception:  # noqa: BLE001
            pass
    for d, n in dc.most_common(12):
        print(f"  {d:<22s} {n}")

    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
