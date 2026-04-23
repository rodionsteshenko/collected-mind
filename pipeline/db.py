"""SQLite connection + schema."""
from __future__ import annotations

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "data.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS concepts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    slug            TEXT UNIQUE NOT NULL,
    title           TEXT NOT NULL,
    source_list     TEXT NOT NULL,
    wiki_url        TEXT NOT NULL,
    wiki_pageid     INTEGER,
    wiki_extract    TEXT,
    wiki_fetched_at TEXT,
    -- enrichment
    one_liner       TEXT,
    aha_explanation TEXT,
    canonical_example TEXT,
    domain          TEXT,   -- JSON array
    form            TEXT,
    affect          TEXT,   -- JSON array
    obscurity       INTEGER,
    prerequisites_raw TEXT, -- JSON array of free-text strings
    surprise_score  INTEGER,
    enriched_at     TEXT,
    enrich_model    TEXT,
    content_hash    TEXT,
    -- quality / lifecycle
    dropped         INTEGER DEFAULT 0,
    drop_reason     TEXT,
    merged_into     INTEGER,  -- slug id of canonical concept after dedup
    -- embedding
    embedding       BLOB,
    embedding_model TEXT,
    embedded_at     TEXT
);

CREATE INDEX IF NOT EXISTS ix_concepts_source ON concepts(source_list);
CREATE INDEX IF NOT EXISTS ix_concepts_slug ON concepts(slug);

CREATE TABLE IF NOT EXISTS edges (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    src_id    INTEGER NOT NULL REFERENCES concepts(id),
    dst_id    INTEGER NOT NULL REFERENCES concepts(id),
    kind      TEXT NOT NULL,   -- prerequisite_of, specializes, contrasts_with, example_of, same_phenomenon_different_frame
    source    TEXT NOT NULL,   -- 'llm' | 'prereq-resolve' | 'semantic-dedup' | 'manual'
    weight    REAL DEFAULT 1.0,
    note      TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(src_id, dst_id, kind)
);

CREATE INDEX IF NOT EXISTS ix_edges_src ON edges(src_id);
CREATE INDEX IF NOT EXISTS ix_edges_dst ON edges(dst_id);

-- Generic KV cache for LLM/API responses keyed by content hash.
CREATE TABLE IF NOT EXISTS cache (
    key       TEXT PRIMARY KEY,
    value     TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
"""


def connect(path: Path = DB_PATH) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


if __name__ == "__main__":
    conn = connect()
    print(f"DB ready at {DB_PATH}")
    conn.close()
