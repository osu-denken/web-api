-- Migration number: 0006 	 2026-07-10T00:00:00.000Z
-- 非公開記事。公開リポジトリには置けないので本文ごと D1 に持つ
CREATE TABLE IF NOT EXISTS private_posts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT    NOT NULL UNIQUE,
    title       TEXT    NOT NULL,
    content     TEXT    NOT NULL,
    author_id   INTEGER NOT NULL REFERENCES members(id),
    author_name TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_private_posts_updated_at ON private_posts (updated_at DESC);
