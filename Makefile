.PHONY: install scrape enrich embed edges export web dev clean

PY := .venv/bin/python

install:
	python3.12 -m venv .venv
	$(PY) -m pip install -U pip
	$(PY) -m pip install -e .[dev]
	cd web && npm install

scrape:
	$(PY) -m pipeline.scrape.run

enrich:
	$(PY) -m pipeline.enrich.run

embed:
	$(PY) -m pipeline.embed.run

edges:
	$(PY) -m pipeline.edges.run

export:
	$(PY) -m pipeline.export

web:
	cd web && npm run build

dev:
	cd web && npm run dev

clean:
	rm -rf .venv web/node_modules web/.next web/out

stats:
	$(PY) -m pipeline.stats
