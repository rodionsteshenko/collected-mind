# Collected Mind

A personal knowledge map of ~2,500 named patterns of thought — cognitive
biases, fallacies, paradoxes, named effects, eponymous laws, narrative
techniques, rhetorical devices, stock characters, defense mechanisms,
software anti-patterns, game-theoretic situations, and thought experiments
— scraped from Wikipedia and enriched with one-line "aha" framings.

Includes:
- **Browse / search** the corpus.
- **Concept pages** with neighborhood graphs (force-directed view of
  semantically near concepts).
- **Advisor** — describe a situation, get 4–6 relevant concepts surfaced
  by an agent that searches the corpus across multiple angles.

## Architecture

```
Wikipedia ──► pipeline/ ──► SQLite ──► web/public/data/*.json ──► Next.js (web/)
                                                                         │
                                                                         └─► /api/advise (Claude Agent SDK)
```

- **Pipeline** (Python, `pipeline/`): scrape → enrich → embed → edges → export.
- **Storage**: SQLite (`pipeline/data.db`) is the source of truth; static
  JSON/binary files are exported into `web/public/data/` for the web app.
- **Web** (Next.js, `web/`): static-feeling reader plus two API routes
  (`/api/advise`, `/api/log`) that run the advisor agent in-process via
  the Claude Agent SDK.

## Setup

```sh
make install            # creates .venv, installs Python + npm deps
echo "OPENAI_API_KEY=sk-..." > .env
ln -s "$(pwd)/.env" web/.env.local   # so Next.js sees the key
```

The advisor uses the Claude CLI's existing OAuth login (no
`ANTHROPIC_API_KEY` needed) — make sure `claude` is logged in.

## Run the pipeline

```sh
make scrape    # pull list pages + curated seeds, populate SQLite
make enrich    # one LLM call per concept (gpt-4o-mini, ~$0.20 / 1k)
make embed     # OpenAI text-embedding-3-small, normalized
make edges     # cosine top-k neighbors + a few prerequisite edges
make export    # write web/public/data/{concepts,edges,...}.json
```

Each step is incremental — only new/changed concepts hit the API.

## Run the web app

```sh
make dev       # next dev on :3030
```

Open `http://localhost:3030/`.

## Adding new sources

Edit `pipeline/scrape/sources.py`:

- `Source(...)` — for Wikipedia "List of X" pages with `<li>` or
  `<table class="wikitable">` entries.
- `ManualSource(...)` — for curated lists of Wikipedia article titles
  when no clean list page exists (e.g. defense mechanisms).

Then re-run `scrape → enrich → embed → edges → export`.

## Layout

```
pipeline/        Python pipeline (scrape, enrich, embed, edges, export)
web/             Next.js app (browse, search, concept pages, advisor)
web/public/data/ Exported corpus consumed by the web app
```
