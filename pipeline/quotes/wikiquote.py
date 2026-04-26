"""Wikiquote API client + wikitext quote extractor.

Wikiquote topic pages (e.g. "Wisdom") and person pages (e.g. "Seneca") follow a
similar bullet-list shape: top-level `*` items are quotes, nested `**` items
hold attribution / source notes. We parse with mwparserfromhell, then apply a
few sanity filters to drop section dividers and meta-bullets.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Any

import mwparserfromhell as mwp
import requests
from tenacity import retry, stop_after_attempt, wait_exponential

API = "https://en.wikiquote.org/w/api.php"
USER_AGENT = "collected-mind/0.1 (personal knowledge map; contact: rsteshenko@gmail.com)"

_session = requests.Session()
_session.headers.update({"User-Agent": USER_AGENT, "Accept-Encoding": "gzip"})

_last_call_at = 0.0
MIN_INTERVAL = 0.1


def _throttle() -> None:
    global _last_call_at
    dt = time.monotonic() - _last_call_at
    if dt < MIN_INTERVAL:
        time.sleep(MIN_INTERVAL - dt)
    _last_call_at = time.monotonic()


@retry(stop=stop_after_attempt(4), wait=wait_exponential(min=1, max=10))
def _get(url: str, params: dict[str, Any]) -> requests.Response:
    _throttle()
    r = _session.get(url, params=params, timeout=30)
    r.raise_for_status()
    return r


@dataclass
class WikiQuote:
    text: str
    attribution: str  # may be empty
    source_url: str


def fetch_wikitext(title: str) -> tuple[str, str] | None:
    """Return (canonical_title, wikitext) for a Wikiquote page, or None if missing.

    Follows redirects. Disambiguation pages return their wikitext too — the
    caller can decide whether to recurse into a specific entry.
    """
    r = _get(
        API,
        params={
            "action": "query",
            "titles": title,
            "prop": "revisions",
            "rvprop": "content",
            "rvslots": "main",
            "format": "json",
            "formatversion": 2,
            "redirects": 1,
        },
    )
    data = r.json()
    pages = data.get("query", {}).get("pages", [])
    if not pages or "missing" in pages[0]:
        return None
    p = pages[0]
    rev = (p.get("revisions") or [{}])[0]
    text = rev.get("slots", {}).get("main", {}).get("content", "")
    return p.get("title", title), text


# Strip MediaWiki markup that survives mwparserfromhell.strip_code() in odd cases.
_REF_RE = re.compile(r"<ref[^>]*?>.*?</ref>|<ref[^/]*?/>", re.DOTALL | re.IGNORECASE)
_BR_RE = re.compile(r"<\s*br\s*/?\s*>", re.IGNORECASE)
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_BRACKETS_RE = re.compile(r"\[\[(?:[^|\]]+\|)?([^\]]+)\]\]")
_MULTISPACE_RE = re.compile(r"\s+")
_LEADING_QUOTE_RE = re.compile(r'^[\'"\u201c\u201d\u2018\u2019]+')
_TRAILING_QUOTE_RE = re.compile(r'[\'"\u201c\u201d\u2018\u2019]+$')
_DASH_ATTRIB_RE = re.compile(r"\s+[\u2014\u2013\-]{1,2}\s+(.+)$")


def _clean(s: str) -> str:
    s = _REF_RE.sub("", s)
    # `<br/>` between lines should become a space, not nothing.
    s = _BR_RE.sub(" ", s)
    try:
        s = mwp.parse(s).strip_code()
    except Exception:  # noqa: BLE001
        s = _BRACKETS_RE.sub(r"\1", s)
    s = _HTML_TAG_RE.sub("", s)
    s = _MULTISPACE_RE.sub(" ", s).strip()
    return s


def _strip_outer_quotes(s: str) -> str:
    s = _LEADING_QUOTE_RE.sub("", s)
    s = _TRAILING_QUOTE_RE.sub("", s)
    return s.strip()


def _looks_like_quote(text: str) -> bool:
    if len(text) < 20 or len(text) > 600:
        return False
    if " " not in text:
        return False
    # Drop meta-bullets that survived (e.g. "See also: Wisdom").
    lower = text.lower()
    for prefix in ("see also", "main article", "external links", "further reading"):
        if lower.startswith(prefix):
            return False
    # Drop bullets that are mostly a single wikilink (navigation).
    letters = sum(1 for c in text if c.isalpha())
    if letters < len(text) * 0.5:
        return False
    return True


def extract_quotes(wikitext: str, source_url: str, max_quotes: int = 8) -> list[WikiQuote]:
    """Walk the wikitext and pull out top-level bullet quotes with attributions."""
    out: list[WikiQuote] = []
    seen: set[str] = set()

    # mwparserfromhell doesn't model list nesting cleanly, so work line-by-line.
    # A `*`-prefixed line is a quote; the immediately following `**`/`***` lines
    # are attribution / sub-notes for that quote.
    lines = wikitext.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.lstrip()
        # Top-level bullet: starts with exactly one `*` followed by space/text.
        if stripped.startswith("*") and not stripped.startswith("**"):
            body = stripped[1:].lstrip()
            attribution_parts: list[str] = []
            j = i + 1
            while j < len(lines):
                nxt = lines[j].lstrip()
                if nxt.startswith("**"):
                    attribution_parts.append(nxt.lstrip("*").strip())
                    j += 1
                else:
                    break
            quote_text = _clean(body)
            # If no nested attribution, try splitting on em-dash inside the line.
            attribution = " — ".join(_clean(p) for p in attribution_parts if p.strip())
            if not attribution:
                m = _DASH_ATTRIB_RE.search(quote_text)
                if m:
                    attribution = m.group(1).strip()
                    quote_text = quote_text[: m.start()].rstrip()
            quote_text = _strip_outer_quotes(quote_text)
            if _looks_like_quote(quote_text) and quote_text not in seen:
                seen.add(quote_text)
                out.append(WikiQuote(text=quote_text, attribution=attribution, source_url=source_url))
                if len(out) >= max_quotes:
                    return out
            i = j
        else:
            i += 1
    return out


def page_url(canonical_title: str) -> str:
    return f"https://en.wikiquote.org/wiki/{canonical_title.replace(' ', '_')}"


def fetch_quotes(title: str, max_quotes: int = 8) -> list[WikiQuote]:
    """High-level entry point: title → list of quotes (possibly empty)."""
    res = fetch_wikitext(title)
    if not res:
        return []
    canonical, wikitext = res
    return extract_quotes(wikitext, page_url(canonical), max_quotes=max_quotes)
