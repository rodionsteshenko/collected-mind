"""Thin MediaWiki API client.

All calls go through a single ``requests.Session`` with a polite User-Agent
and small sleep between requests to stay under WMF guidelines.
"""
from __future__ import annotations

import time
from typing import Any

import requests
from tenacity import retry, stop_after_attempt, wait_exponential

API = "https://en.wikipedia.org/w/api.php"
REST_SUMMARY = "https://en.wikipedia.org/api/rest_v1/page/summary/"
USER_AGENT = "collected-mind/0.1 (personal knowledge map; contact: rsteshenko@gmail.com)"

_session = requests.Session()
_session.headers.update({"User-Agent": USER_AGENT, "Accept-Encoding": "gzip"})

_last_call_at = 0.0
MIN_INTERVAL = 0.1  # seconds — gentle


def _throttle() -> None:
    global _last_call_at
    dt = time.monotonic() - _last_call_at
    if dt < MIN_INTERVAL:
        time.sleep(MIN_INTERVAL - dt)
    _last_call_at = time.monotonic()


@retry(stop=stop_after_attempt(4), wait=wait_exponential(min=1, max=10))
def _get(url: str, params: dict[str, Any] | None = None) -> requests.Response:
    _throttle()
    r = _session.get(url, params=params, timeout=30)
    r.raise_for_status()
    return r


def fetch_page_html(page: str) -> str:
    """Return parsed HTML fragment for a page (action=parse, prop=text)."""
    r = _get(
        API,
        params={
            "action": "parse",
            "page": page,
            "prop": "text",
            "format": "json",
            "formatversion": 2,
            "redirects": 1,
        },
    )
    data = r.json()
    if "error" in data:
        raise RuntimeError(f"MediaWiki error for {page!r}: {data['error']}")
    return data["parse"]["text"]


def fetch_summaries(titles: list[str]) -> dict[str, dict[str, Any]]:
    """Batch-fetch intro extracts + pageids for a list of titles.

    Returns a map keyed by *every* input-title alias that resolved to a page —
    both the requested title and any intermediate redirect/normalization forms.
    Entries include: pageid, title (canonical), extract, canonicalurl.
    """
    out: dict[str, dict[str, Any]] = {}
    # `prop=extracts` is capped at 20 per call for anonymous users (exlimit).
    for i in range(0, len(titles), 20):
        chunk = titles[i : i + 20]
        r = _get(
            API,
            params={
                "action": "query",
                "titles": "|".join(chunk),
                "prop": "extracts|info",
                "exintro": 1,
                "explaintext": 1,
                "exlimit": 20,
                "inprop": "url",
                "format": "json",
                "formatversion": 2,
                "redirects": 1,
            },
        )
        data = r.json()
        q = data.get("query", {})
        # Chain of aliases: input -> normalized -> redirected -> canonical.
        # Build forward map so each alias points to the final canonical title.
        alias_to_final: dict[str, str] = {t: t for t in chunk}
        for step in ("normalized", "redirects"):
            for hop in q.get(step, []):
                frm, to = hop.get("from"), hop.get("to")
                if not frm or not to:
                    continue
                for k, v in list(alias_to_final.items()):
                    if v == frm:
                        alias_to_final[k] = to
        by_title = {}
        for p in q.get("pages", []):
            if "missing" in p:
                continue
            by_title[p["title"]] = {
                "pageid": p.get("pageid"),
                "title": p.get("title"),
                "extract": p.get("extract", ""),
                "canonicalurl": p.get("canonicalurl", ""),
            }
        for alias, final in alias_to_final.items():
            payload = by_title.get(final)
            if payload is not None:
                out[alias] = payload
    return out
