# Agent notes

For agents (Claude Code, etc.) working in this repo.

## What this repo is

Two halves connected by a static export:

- **`pipeline/`** — Python. Scrapes Wikipedia, enriches via OpenAI,
  embeds, computes edges, exports JSON to `web/public/data/`.
- **`web/`** — Next.js 16 app router. Reads the exported JSON at
  request/build time. Hosts the advisor as in-process API routes.

`pipeline/data.db` is the source of truth; `web/public/data/*` is a
derived artifact and is committed (so the web app works without
running the pipeline).

See `web/AGENTS.md` for Next.js-specific guidance — that one warns
that this is **not** the Next.js you remember from training data.

## Pipeline

Sequence: `scrape → enrich → embed → edges → export`. Each step is
incremental and idempotent.

- **scrape** (`pipeline/scrape/run.py`): pulls Wikipedia list pages
  defined in `sources.py`. Two source types: `Source` (a "List of X"
  page) and `ManualSource` (a curated tuple of article titles for when
  no clean list exists). The extractor handles `<li>` lists and
  `<table class="wikitable">` rows.
- **enrich** (`pipeline/enrich/run.py`): one LLM call per concept,
  using OpenAI structured outputs against `Enriched` (Pydantic). Model
  is `gpt-4o-mini` by default. Cached by content hash, so re-runs are
  cheap.
- **embed** (`pipeline/embed/run.py`): OpenAI
  `text-embedding-3-small`, L2-normalized, stored as a Float32 binary
  blob.
- **edges** (`pipeline/edges/run.py`): cosine top-k semantic neighbors
  plus a small number of LLM-suggested prerequisite edges.
- **export** (`pipeline/export.py`): writes `concepts.json`,
  `edges.json`, `embeddings.bin`, `embeddings_meta.json`,
  `search.json`, `tags.json` into `web/public/data/`.

Schema lives in `pipeline/enrich/schema.py`. When adding new `form` or
`Domain` values, update the `Literal[...]` lists there — they're
enforced via OpenAI structured outputs.

## Advisor

`web/src/app/api/advise/route.ts` streams Server-Sent Events while the
Claude Agent SDK runs an agent loop with four MCP tools over the
corpus (`search_semantic`, `search_text`, `get_concept`,
`filter_by_facet`). The agent is instructed to end with two literal
tags: `<framing>...</framing>` and `<picks>[{slug, why}, ...]</picks>`.
Results are appended to `web/.advisor-data/log.jsonl` (gitignored).

- Auth: uses the user's `claude` CLI OAuth — no `ANTHROPIC_API_KEY`
  needed. Embeddings still use `OPENAI_API_KEY` (loaded via
  `web/.env.local`, which is symlinked to root `.env`).
- Models: `claude-sonnet-4-6` (default) or `claude-haiku-4-5`. There
  is no `claude-haiku-4-6` — the API will reject it.
- The advisor previously ran as a separate Fastify side-car on
  port 3031; it's been folded into Next.js so there's only one
  process to start (`make dev`).

## Concept pages and the ego graph

`web/src/app/c/[slug]/page.tsx` is a server component that builds a
neighborhood graph for the current concept (center + outgoing
semantic neighbors + reciprocal neighbors + interior edges among
them) and hands it to `<EgoGraph />` (client, d3-force,
`web/src/components/EgoGraph.tsx`).

Static export was removed from `next.config.ts` (no `output:
"export"`) so API routes can run.

## Useful invariants and gotchas

- `trailingSlash: true` in `next.config.ts` — links and `curl`
  commands need the trailing slash, otherwise a 307 redirect.
- Embeddings are L2-normalized at write time; cosine similarity is
  just a dot product downstream.
- Slugs are produced by `pipeline/util.slugify` — the rule for
  recovering a slug from a title is "lowercase, ASCII fold,
  non-alnum → hyphen, collapse, trim". For `Title (qualifier)`, the
  qualifier becomes part of the slug (e.g. `repression-psychology`).
- The pipeline's `dropped`/`drop_reason` columns exist but the
  current threshold (`SURPRISE_DROP_THRESHOLD = 4`) hasn't been
  dropping anything — most enriched concepts score ≥4.
- `web/public/data/*` IS committed. If you regenerate it, commit
  the result so deploys don't need to run the pipeline.

## Common tasks

- **Add a new concept source**: edit `pipeline/scrape/sources.py`,
  then run `make scrape enrich embed edges export`.
- **Re-enrich everything**: `python -m pipeline.enrich.run --force`.
- **Test a single concept page locally**: `make dev`, then
  `http://localhost:3030/c/<slug>/`.
- **Smoke-test the advisor**:
  ```
  curl -sN -X POST http://localhost:3030/api/advise/ \
    -H 'Content-Type: application/json' \
    -d '{"situation":"...","model":"claude-sonnet-4-6"}'
  ```

## What lives where

```
pipeline/
  scrape/     Wikipedia ingestion + extractor
  enrich/     LLM enrichment (prompt, schema, runner)
  embed/      OpenAI embeddings
  edges/      Semantic + prerequisite edges
  export.py   SQLite → web/public/data/*

web/src/
  app/
    page.tsx              Home (daily picks)
    browse/               Faceted browse
    search/               MiniSearch over titles + oneLiner
    c/[slug]/page.tsx     Concept page + ego graph
    advise/page.tsx       Advisor UI
    api/advise/route.ts   Advisor SSE endpoint
    api/log/route.ts      Past-answers feed
  components/
    EgoGraph.tsx          d3-force neighborhood viz
    Advisor.tsx           Advisor UI client component
  lib/
    advisor/              Corpus, embed, log, prompt, MCP tools
    egoGraph.ts           Server-side neighborhood builder
    data.ts               Static JSON loaders
```
