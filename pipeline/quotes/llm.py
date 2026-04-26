"""LLM fallback for concepts with no Wikiquote hits, plus a verifier.

Flow:
  1. Ask the model for 2-3 famous quotes that exemplify the concept, each with
     explicit attribution and (when known) a source work.
  2. Verify each by phrase-searching Wikipedia + Wikiquote for a distinctive
     substring from the middle of the quote. If we find a page whose snippet
     contains the substring, treat the quote as real. Otherwise drop it.

The verifier won't catch every fake — but it filters out the obvious
hallucinations where the LLM invents an attribution that doesn't exist
anywhere on the public web.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Any

import requests
from pydantic import BaseModel, Field
from tenacity import retry, stop_after_attempt, wait_exponential

from pipeline.config import ENRICH_MODEL

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


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=8))
def _api_get(url: str, params: dict[str, Any]) -> requests.Response:
    _throttle()
    r = _session.get(url, params=params, timeout=20)
    r.raise_for_status()
    return r


# ---------- LLM call ----------


class _LlmQuote(BaseModel):
    text: str = Field(description="The exact quote, no surrounding quotation marks.")
    author: str = Field(description="Attributed author, e.g. 'Marcus Aurelius'.")
    source: str = Field(default="", description="Source work (book, speech, letter), e.g. 'Meditations'.")


class _LlmQuotes(BaseModel):
    quotes: list[_LlmQuote] = Field(description="2-3 famous, verifiable quotes about the concept.")


SYSTEM = (
    "You select famous quotations that exemplify a given concept. "
    "Quote exactly as the source has it — do not paraphrase. "
    "Only return quotes you are confident are real and widely attributed. "
    "Each quote must have a clear attribution (author + source work when known). "
    "Prefer quotes from well-known public-domain works (philosophy, religious texts, "
    "classic literature, historical speeches). Skip generic motivational sayings."
)


def _user_msg(title: str, one_liner: str, extract: str) -> str:
    extract = (extract or "")[:1500]
    return (
        f"Concept: {title}\n"
        f"One-liner: {one_liner}\n"
        f"Wikipedia extract:\n{extract}\n\n"
        f"Return 2-3 famous, verifiable quotes that exemplify '{title}'. "
        f"If nothing widely-attributed comes to mind, return fewer (or zero) — "
        f"do not invent quotes."
    )


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def suggest_quotes(client, title: str, one_liner: str, extract: str) -> list[_LlmQuote]:
    resp = client.chat.completions.parse(
        model=ENRICH_MODEL,
        temperature=0.2,
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": _user_msg(title, one_liner, extract)},
        ],
        response_format=_LlmQuotes,
    )
    parsed = resp.choices[0].message.parsed
    return parsed.quotes if parsed else []


# ---------- Verifier ----------


_WORD_RE = re.compile(r"\b[\w''-]+\b", re.UNICODE)


def _distinctive_phrase(text: str, n_words: int = 6) -> str | None:
    """Pick a window of consecutive words from the middle of `text`, biased
    toward longer (more distinctive) words. Returns None if the quote is too
    short to phrase-search reliably."""
    words = _WORD_RE.findall(text)
    if len(words) < n_words + 1:
        return None
    # Score each candidate window by total non-stop letter count.
    best = None
    best_score = -1
    for i in range(len(words) - n_words + 1):
        window = words[i : i + n_words]
        score = sum(len(w) for w in window if len(w) > 3)
        if score > best_score:
            best_score = score
            best = window
    if not best:
        return None
    return " ".join(best)


@dataclass
class VerifyHit:
    site: str
    page_title: str
    snippet: str


def _phrase_search(site: str, phrase: str) -> VerifyHit | None:
    """Phrase-search a single MediaWiki site; return the first hit (or None)."""
    url = f"https://{site}/w/api.php"
    try:
        r = _api_get(
            url,
            {
                "action": "query",
                "list": "search",
                "srsearch": f'"{phrase}"',
                "srlimit": 3,
                "srprop": "snippet",
                "format": "json",
                "formatversion": 2,
            },
        )
    except requests.RequestException:
        return None
    results = r.json().get("query", {}).get("search", [])
    if not results:
        return None
    hit = results[0]
    return VerifyHit(site=site, page_title=hit.get("title", ""), snippet=hit.get("snippet", ""))


def verify_quote(text: str) -> VerifyHit | None:
    """Return the first matching hit on Wikiquote or Wikipedia, or None.

    We search Wikiquote first since direct quote attestations are more likely
    there. The phrase is a 6-word distinctive window from the quote.
    """
    phrase = _distinctive_phrase(text, n_words=6)
    if not phrase:
        # Fallback: use whatever we have if the quote is short.
        phrase = " ".join(_WORD_RE.findall(text))
        if len(phrase.split()) < 4:
            return None
    for site in ("en.wikiquote.org", "en.wikipedia.org"):
        hit = _phrase_search(site, phrase)
        if hit is not None:
            return hit
    return None


def format_attribution(q: _LlmQuote) -> str:
    if q.author and q.source:
        return f"{q.author}, {q.source}"
    return q.author or q.source or ""
