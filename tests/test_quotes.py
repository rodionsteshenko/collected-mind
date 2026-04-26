"""Tests for the quotes pipeline.

We exercise the pure parsing + verification primitives directly. Network
calls (Wikiquote API, OpenAI) are not invoked — `extract_quotes` is fed raw
wikitext, and `_distinctive_phrase` works on plain strings.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline.quotes.llm import (  # noqa: E402
    _distinctive_phrase,
    _LlmQuote,  # noqa: E402
    format_attribution,
)
from pipeline.quotes.wikiquote import (  # noqa: E402
    _clean,
    _looks_like_quote,
    _strip_outer_quotes,
    extract_quotes,
)


class TestClean:
    def test_strips_ref_tags(self):
        assert _clean("Hello <ref>cite</ref> world") == "Hello world"

    def test_strips_self_closing_ref(self):
        assert _clean("Hello<ref name=x/> world") == "Hello world"

    def test_replaces_br_with_space(self):
        assert _clean("Line one<br/>Line two") == "Line one Line two"
        assert _clean("Line one<br />Line two") == "Line one Line two"
        assert _clean("Line one<br>Line two") == "Line one Line two"

    def test_resolves_wikilinks(self):
        # [[Target|display]] → display ; [[Plain]] → Plain
        assert _clean("See [[Wisdom|wisdom]] and [[Hope]].") == "See wisdom and Hope."

    def test_strips_italic_bold_markup(self):
        assert _clean("''italic'' and '''bold'''") == "italic and bold"

    def test_collapses_whitespace(self):
        assert _clean("a   b\tc\n\nd") == "a b c d"


class TestStripOuterQuotes:
    def test_strips_double_quotes(self):
        assert _strip_outer_quotes('"hello"') == "hello"

    def test_strips_curly_quotes(self):
        assert _strip_outer_quotes("\u201chello\u201d") == "hello"

    def test_leaves_internal_dialog_quotes_alone(self):
        # Outer wrapping quotes are stripped; an internal-only quote is kept.
        assert _strip_outer_quotes('"hello world"') == "hello world"
        assert _strip_outer_quotes("hello") == "hello"


class TestLooksLikeQuote:
    def test_rejects_too_short(self):
        assert not _looks_like_quote("hi")

    def test_rejects_too_long(self):
        assert not _looks_like_quote("a" * 700)

    def test_rejects_no_spaces(self):
        assert not _looks_like_quote("aaaaaaaaaaaaaaaaaaaaaaaaa")

    def test_rejects_meta_bullets(self):
        assert not _looks_like_quote("See also: Wisdom and other concepts of value.")
        assert not _looks_like_quote("External links — references and notes.")

    def test_accepts_normal_quote(self):
        assert _looks_like_quote("The unexamined life is not worth living for a human being.")


class TestExtractQuotes:
    def test_basic_topic_page(self):
        wikitext = """
== Quotes ==
* The unexamined life is not worth living.
** Socrates, ''Apology'' (399 BC)
* The greatest wealth is to live content with little.
** Plato, ''Republic''
"""
        out = extract_quotes(wikitext, "https://en.wikiquote.org/wiki/Wisdom")
        assert len(out) == 2
        assert out[0].text == "The unexamined life is not worth living."
        assert "Socrates" in out[0].attribution
        assert "Apology" in out[0].attribution
        assert "wealth" in out[1].text
        assert "Plato" in out[1].attribution

    def test_dash_attribution_in_same_line(self):
        wikitext = "* Be the change you wish to see in the world. \u2014 Mahatma Gandhi"
        out = extract_quotes(wikitext, "url")
        assert len(out) == 1
        assert "change" in out[0].text
        assert "Gandhi" in out[0].attribution

    def test_strips_ref_tags_from_quote(self):
        wikitext = "* The truth will set you free.<ref>John 8:32</ref>\n** Jesus"
        out = extract_quotes(wikitext, "url")
        assert len(out) == 1
        assert "<ref>" not in out[0].text
        assert "set you free" in out[0].text

    def test_drops_meta_bullets(self):
        wikitext = """
* See also
** Other articles
* The real quote that survives all filtering checks.
** Some Author
"""
        out = extract_quotes(wikitext, "url")
        assert len(out) == 1
        assert "real quote" in out[0].text

    def test_dedupes_identical_quotes(self):
        wikitext = """
* The same quote appears twice in this corpus.
** Author A
* The same quote appears twice in this corpus.
** Author B
"""
        out = extract_quotes(wikitext, "url")
        assert len(out) == 1

    def test_respects_max_quotes(self):
        wikitext = "\n".join(f"* This is a long enough quote number {i} to pass the filter." for i in range(20))
        out = extract_quotes(wikitext, "url", max_quotes=3)
        assert len(out) == 3

    def test_handles_nested_double_star_only(self):
        # `**` lines without a preceding `*` should not produce stray quotes.
        wikitext = "** orphan attribution\n*** another orphan"
        out = extract_quotes(wikitext, "url")
        assert out == []

    def test_empty_wikitext(self):
        assert extract_quotes("", "url") == []


class TestDistinctivePhrase:
    def test_returns_six_word_window(self):
        text = "The unexamined life is not worth living for a human being."
        phrase = _distinctive_phrase(text, n_words=6)
        assert phrase is not None
        assert len(phrase.split()) == 6

    def test_too_short_returns_none(self):
        assert _distinctive_phrase("Just three words", n_words=6) is None

    def test_prefers_longer_words(self):
        # Window with longer words should win over a window of stopwords-only.
        text = "the the the the the philosophical antifragility is profound"
        phrase = _distinctive_phrase(text, n_words=4)
        assert phrase is not None
        assert "philosophical" in phrase or "antifragility" in phrase or "profound" in phrase


class TestFormatAttribution:
    def test_author_and_source(self):
        q = _LlmQuote(text="Hi", author="Aristotle", source="Ethics")
        assert format_attribution(q) == "Aristotle, Ethics"

    def test_author_only(self):
        q = _LlmQuote(text="Hi", author="Aristotle", source="")
        assert format_attribution(q) == "Aristotle"

    def test_source_only_falls_back(self):
        q = _LlmQuote(text="Hi", author="", source="Ethics")
        assert format_attribution(q) == "Ethics"

    def test_neither_returns_empty(self):
        q = _LlmQuote(text="Hi", author="", source="")
        assert format_attribution(q) == ""
