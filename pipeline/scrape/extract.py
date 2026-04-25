"""Extract candidate concept links from a Wikipedia list page's HTML.

Strategy: walk top-level children of ``.mw-parser-output``, track the current
H2 section, and extract <li> entries only from sections that aren't in the
``exclude`` set. This works reliably across Wikipedia's modern markup where
headings are wrapped in ``<div class="mw-heading mw-heading2">``.
"""
from __future__ import annotations

import re
from urllib.parse import unquote

from bs4 import BeautifulSoup, Tag

_BAD_PREFIXES = (
    "Wikipedia:",
    "Help:",
    "Portal:",
    "Category:",
    "File:",
    "Template:",
    "Talk:",
    "Special:",
    "Book:",
    "Draft:",
    "Module:",
    "MediaWiki:",
)

_TITLE_BLOCKLIST = (
    re.compile(r"^List of\b", re.IGNORECASE),
    re.compile(r"^Outline of\b", re.IGNORECASE),
    re.compile(r"^Index of\b", re.IGNORECASE),
)

# Section headings we never want to scrape items from, keyed by normalized
# heading text (lowercase, whitespace-collapsed, "[edit]" suffix stripped).
_EXCLUDE_SECTIONS_DEFAULT = frozenset({
    "see also",
    "references",
    "notes",
    "further reading",
    "external links",
    "bibliography",
    "sources",
    "notable researchers",
    "notable memory researchers",
    "famous mnemonists",
    "people",
    "scholars",
    "contributors",
    "in popular culture",
    "in fiction",
    "media",
})


def _is_bad_title(title: str) -> bool:
    if not title:
        return True
    if title.startswith(_BAD_PREFIXES):
        return True
    if any(p.search(title) for p in _TITLE_BLOCKLIST):
        return True
    return False


def _href_to_title(href: str) -> str | None:
    if not href.startswith("/wiki/"):
        return None
    rest = href[len("/wiki/") :]
    rest = rest.split("#", 1)[0]
    if not rest:
        return None
    return unquote(rest).replace("_", " ")


def _heading_info(node: Tag) -> tuple[int, str] | None:
    """If ``node`` is a heading wrapper, return (level, normalized_text)."""
    if not isinstance(node, Tag) or node.name != "div":
        return None
    classes = node.get("class") or []
    level = None
    for c in classes:
        if c.startswith("mw-heading") and c[len("mw-heading") :].isdigit():
            level = int(c[len("mw-heading") :])
            break
    if level is None:
        return None
    h = node.find(["h1", "h2", "h3", "h4", "h5", "h6"])
    if h is None:
        return None
    text = h.get_text(" ", strip=True)
    text = re.sub(r"\[\s*edit\s*\]$", "", text, flags=re.IGNORECASE).strip().lower()
    return level, text


_NON_CONTENT_TABLE_CLASSES = frozenset(
    {"ambox", "navbox", "infobox", "sidebar", "metadata", "plainlinks", "hatnote"}
)


def _is_content_table(t: Tag) -> bool:
    classes = set(t.get("class") or [])
    if classes & _NON_CONTENT_TABLE_CLASSES:
        return False
    return "wikitable" in classes


def _extract_table_rows(table: Tag, accept: set[str], collected: list[tuple[str, str]]) -> None:
    """For a wikitable, take the first content link in each non-header row."""
    for tr in table.find_all("tr"):
        if tr.find("th") and not tr.find("td"):
            continue  # pure header row
        first_cell = tr.find(["td", "th"])
        if not first_cell:
            continue
        a = first_cell.find("a", href=True)
        if not a or not isinstance(a, Tag):
            continue
        cls = a.get("class") or []
        if any(c in ("external", "mw-cite-backlink") for c in cls):
            continue
        title = _href_to_title(a["href"])
        if not title or _is_bad_title(title):
            continue
        if title in accept:
            continue
        accept.add(title)
        collected.append((title, a.get_text(strip=True) or title))


def _extract_li_links(container: Tag, accept: set[str], collected: list[tuple[str, str]]) -> None:
    # If the container itself is a content table, extract from it directly.
    if container.name == "table" and _is_content_table(container):
        _extract_table_rows(container, accept, collected)
        return
    # Content-bearing wikitables first (before stripping tables for li-scan)
    for t in container.find_all("table"):
        if _is_content_table(t):
            _extract_table_rows(t, accept, collected)
    # Now strip tables (content and non-content alike) so li-scan doesn't double-count
    for bad in container.find_all(["table"]):
        bad.decompose()
    for el in container.find_all(class_=["navbox", "infobox", "thumb", "sidebar", "hatnote", "reflist"]):
        el.decompose()
    for li in container.find_all("li"):
        a = li.find("a", href=True)
        if not a or not isinstance(a, Tag):
            continue
        # Skip citation-style links (footnote backrefs, etc.)
        cls = a.get("class") or []
        if any(c in ("external", "mw-cite-backlink") for c in cls):
            continue
        title = _href_to_title(a["href"])
        if not title or _is_bad_title(title):
            continue
        if title in accept:
            continue
        accept.add(title)
        collected.append((title, a.get_text(strip=True) or title))


def extract_entries(
    html: str,
    exclude_sections: tuple[str, ...] = (),
) -> list[tuple[str, str]]:
    """Return ``(title, anchor_text)`` entries in page order.

    ``exclude_sections`` can include Wikipedia anchor IDs (e.g. ``"See_also"``)
    or plain text headings; both are normalized and merged with the default
    excluded-section set.
    """
    soup = BeautifulSoup(html, "lxml")
    root = soup.select_one(".mw-parser-output") or soup

    excluded = set(_EXCLUDE_SECTIONS_DEFAULT)
    for s in exclude_sections:
        excluded.add(s.replace("_", " ").strip().lower())

    seen: set[str] = set()
    out: list[tuple[str, str]] = []
    # Track section stack: h2 name, h3 name, ...
    current_h2: str | None = None

    for node in list(root.children):
        info = _heading_info(node) if isinstance(node, Tag) else None
        if info is not None:
            level, text = info
            if level == 2:
                current_h2 = text
            # h3/h4 don't reset h2 exclusion
            continue
        if not isinstance(node, Tag):
            continue
        if current_h2 in excluded:
            continue
        # Only scan list-bearing containers
        if node.name not in ("ul", "ol", "div", "dl", "section", "p", "table"):
            continue
        _extract_li_links(node, seen, out)

    return out
