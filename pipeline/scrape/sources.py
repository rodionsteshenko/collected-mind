"""Tier 1 Wikipedia source lists.

Each source is a page whose content links to concept articles we want to ingest.
`content_selector` is a CSS selector for the region of the page containing the
list entries — we only extract <li> items inside that region so we skip nav,
see-also, and references sections. Defaults to ``.mw-parser-output`` (whole
article body), with post-filters in ``extract.py`` removing obvious non-entries.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Source:
    # Wikipedia page title (with underscores or spaces; MediaWiki accepts both)
    page: str
    # Short stable id used as `source_list` in the DB
    key: str
    # Human-readable name
    name: str
    # Which `form` to default to when the concept came from this list
    default_form: str
    # Skip any list item whose link title starts with these strings
    skip_prefixes: tuple[str, ...] = field(default_factory=tuple)
    # Section IDs to exclude (Wikipedia anchor ids, lowercase with underscores)
    exclude_sections: tuple[str, ...] = (
        "See_also",
        "References",
        "Notes",
        "Further_reading",
        "External_links",
        "Bibliography",
        "Sources",
    )


SOURCES: list[Source] = [
    Source(
        page="List of cognitive biases",
        key="cognitive_biases",
        name="Cognitive biases",
        default_form="bias",
    ),
    Source(
        page="List of fallacies",
        key="fallacies",
        name="Fallacies",
        default_form="fallacy",
    ),
    Source(
        page="List of paradoxes",
        key="paradoxes",
        name="Paradoxes",
        default_form="paradox",
    ),
    Source(
        page="List of thought experiments",
        key="thought_experiments",
        name="Thought experiments",
        default_form="thought_experiment",
    ),
    Source(
        page="List of effects",
        key="effects",
        name="Named effects",
        default_form="effect",
    ),
]
# Dropped (too meta / too noisy for seed scrape):
#   - "List of common misconceptions" is a meta page that only links to sub-lists
#   - "Outline of ..." pages are navigation graphs and add thousands of loosely
#     related links. Revisit in a Tier 2 pass if we want broader coverage.
