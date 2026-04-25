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
    Source(
        page="List of eponymous laws",
        key="eponymous_laws",
        name="Eponymous laws",
        default_form="law",
    ),
    Source(
        page="List of narrative techniques",
        key="narrative_techniques",
        name="Narrative techniques",
        default_form="device",
    ),
    Source(
        page="List of stock characters",
        key="stock_characters",
        name="Stock characters",
        default_form="archetype",
    ),
    Source(
        page="List of software anti-patterns",
        key="anti_patterns",
        name="Software anti-patterns",
        default_form="anti_pattern",
    ),
    Source(
        page="List of games in game theory",
        key="game_theory_games",
        name="Game theory games",
        default_form="game",
    ),
    Source(
        page="Glossary of rhetorical terms",
        key="rhetorical_terms",
        name="Rhetorical terms",
        default_form="device",
    ),
]


@dataclass
class ManualSource:
    """A curated list of Wikipedia article titles, used when no list page works."""

    key: str
    name: str
    default_form: str
    titles: tuple[str, ...]


MANUAL_SOURCES: list[ManualSource] = [
    ManualSource(
        key="buddhism",
        name="Buddhist concepts",
        default_form="concept",
        titles=(
            "Four Noble Truths",
            "Noble Eightfold Path",
            "Three marks of existence",
            "Anicca",
            "Dukkha",
            "Anattā",
            "Skandha",
            "Pratītyasamutpāda",
            "Śūnyatā",
            "Tathātā",
            "Tathāgatagarbha",
            "Bodhicitta",
            "Bodhisattva",
            "Pāramitā",
            "Three poisons",
            "Karma in Buddhism",
            "Saṃsāra",
            "Nirvana (Buddhism)",
            "Mu (negative)",
            "Satori",
            "Kenshō",
            "Kōan",
            "Shoshin",
            "Mushin (mental state)",
            "Zazen",
            "Mettā",
            "Sati (Buddhism)",
            "Upāya",
            "Two truths doctrine",
            "Middle Way",
        ),
    ),
    ManualSource(
        key="hindu_vedic",
        name="Hindu and Vedic concepts",
        default_form="concept",
        titles=(
            "Dharma",
            "Karma",
            "Moksha",
            "Saṃsāra",
            "Ātman (Hinduism)",
            "Brahman",
            "Maya (religion)",
            "Lila (Hinduism)",
            "Guṇa",
            "Ahimsa",
            "Tat Tvam Asi",
            "Neti neti",
            "Ishvara",
            "Avidyā (Hinduism)",
            "Bhakti",
            "Jnana",
        ),
    ),
    ManualSource(
        key="taoism",
        name="Taoist concepts",
        default_form="concept",
        titles=(
            "Tao",
            "Wu wei",
            "Ziran",
            "De (Chinese)",
            "Pu (Taoism)",
            "Yin and yang",
            "Qi",
            "Three Treasures (Taoism)",
            "Tao Te Ching",
        ),
    ),
    ManualSource(
        key="confucianism",
        name="Confucian concepts",
        default_form="concept",
        titles=(
            "Ren (Confucianism)",
            "Li (Confucianism)",
            "Yi (Confucianism)",
            "Xin (heart-mind)",
            "Junzi",
            "Filial piety",
            "Mandate of Heaven",
            "Rectification of names",
        ),
    ),
    ManualSource(
        key="stoicism",
        name="Stoic concepts",
        default_form="concept",
        titles=(
            "Eudaimonia",
            "Apatheia",
            "Ataraxia",
            "Logos",
            "Amor fati",
            "Memento mori",
            "Negative visualization",
            "Cosmopolitanism",
            "Virtue ethics",
            "Stoic categories",
            "Cardinal virtues",
        ),
    ),
    ManualSource(
        key="greek_philosophy",
        name="Greek philosophical concepts",
        default_form="concept",
        titles=(
            "Sophrosyne",
            "Phronesis",
            "Akrasia",
            "Hubris",
            "Kairos",
            "Arete",
            "Telos",
            "Aporia",
            "Apophasis",
            "Cynicism (philosophy)",
            "Epicureanism",
            "Hedonism",
            "Theory of forms",
            "Allegory of the cave",
            "Socratic method",
            "Maieutics",
        ),
    ),
    ManualSource(
        key="japanese_aesthetics",
        name="Japanese aesthetics",
        default_form="concept",
        titles=(
            "Wabi-sabi",
            "Mono no aware",
            "Yūgen",
            "Iki (aesthetics)",
            "Mujō",
            "Ma (negative space)",
            "Shibui",
            "Kintsugi",
            "Ikigai",
            "Mottainai",
            "Komorebi",
            "Honne and tatemae",
        ),
    ),
    ManualSource(
        key="sufism",
        name="Sufi concepts",
        default_form="concept",
        titles=(
            "Fana (Sufism)",
            "Baqaa",
            "Tawhid",
            "Ihsan",
            "Dhikr",
            "Maqam (Sufism)",
            "Hal (Sufism)",
            "Nafs",
            "Murid",
            "Sohbet",
        ),
    ),
    ManualSource(
        key="jewish_wisdom",
        name="Jewish wisdom",
        default_form="concept",
        titles=(
            "Tikkun olam",
            "Tzimtzum",
            "Bashert",
            "Mensch",
            "Chutzpah",
            "Tzadik",
            "Pikuach nefesh",
            "Pilpul",
            "Devekut",
            "Kavanah",
        ),
    ),
    ManualSource(
        key="existentialism",
        name="Existentialist concepts",
        default_form="concept",
        titles=(
            "Bad faith (existentialism)",
            "Absurdism",
            "Authenticity (philosophy)",
            "Dasein",
            "Being-toward-death",
            "Thrownness",
            "Angst",
            "Eternal return",
            "Will to power",
            "Übermensch",
            "Ressentiment",
            "Negative capability",
            "Apollonian and Dionysian",
            "The Myth of Sisyphus",
        ),
    ),
    ManualSource(
        key="defense_mechanisms",
        name="Defense mechanisms",
        default_form="defense_mechanism",
        titles=(
            "Acting out",
            "Altruism",
            "Anticipation (psychology)",
            "Compartmentalization (psychology)",
            "Compensation (psychology)",
            "Conversion disorder",
            "Denial",
            "Displacement (psychology)",
            "Dissociation (psychology)",
            "Fantasy (psychology)",
            "Idealization and devaluation",
            "Identification (psychology)",
            "Intellectualization",
            "Introjection",
            "Isolation (psychology)",
            "Passive-aggressive behavior",
            "Psychological projection",
            "Projective identification",
            "Rationalization (psychology)",
            "Reaction formation",
            "Regression (psychology)",
            "Repression (psychology)",
            "Splitting (psychology)",
            "Sublimation (psychology)",
            "Thought suppression",
            "Undoing (psychology)",
            "Transference",
            "Countertransference",
            "Triangulation (psychology)",
            "DARVO",
            "Gaslighting",
            "Stonewalling",
            "Codependency",
            "Enmeshment",
            "Parentification",
            "Emotional blackmail",
            "Love bombing",
            "Hoovering (abuse)",
        ),
    ),
]
# Dropped (too meta / too noisy for seed scrape):
#   - "List of common misconceptions" is a meta page that only links to sub-lists
#   - "Outline of ..." pages are navigation graphs and add thousands of loosely
#     related links. Revisit in a Tier 2 pass if we want broader coverage.
