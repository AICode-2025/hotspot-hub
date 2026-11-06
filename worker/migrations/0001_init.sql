-- 0001 初始化：快照、条目、日报、指标、影视榜、源健康
CREATE TABLE IF NOT EXISTS snapshots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT    NOT NULL,
  taken_at    INTEGER NOT NULL,
  adapter     TEXT    NOT NULL DEFAULT '',
  item_count  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_snapshots_source_time ON snapshots(source, taken_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_time ON snapshots(taken_at DESC);

CREATE TABLE IF NOT EXISTS items (
  snapshot_id INTEGER NOT NULL,
  rank        INTEGER NOT NULL,
  title       TEXT    NOT NULL,
  url         TEXT    NOT NULL DEFAULT '',
  hot         TEXT,
  PRIMARY KEY (snapshot_id, rank)
);
CREATE INDEX IF NOT EXISTS idx_items_title ON items(title);

CREATE TABLE IF NOT EXISTS digests (
  date       TEXT PRIMARY KEY,
  news_json  TEXT NOT NULL,
  tip        TEXT NOT NULL DEFAULT '',
  image      TEXT NOT NULL DEFAULT '',
  cover      TEXT NOT NULL DEFAULT '',
  lunar      TEXT NOT NULL DEFAULT '',
  week       TEXT NOT NULL DEFAULT '',
  link       TEXT NOT NULL DEFAULT '',
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS metrics (
  key      TEXT    NOT NULL,
  ts       INTEGER NOT NULL,
  value    REAL    NOT NULL DEFAULT 0,
  raw_json TEXT,
  PRIMARY KEY (key, ts)
);
CREATE INDEX IF NOT EXISTS idx_metrics_key_ts ON metrics(key, ts DESC);

CREATE TABLE IF NOT EXISTS media_rank (
  board TEXT    NOT NULL,
  ts    INTEGER NOT NULL,
  rank  INTEGER NOT NULL,
  title TEXT    NOT NULL,
  score TEXT NOT NULL DEFAULT '',
  url   TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (board, ts, rank)
);
CREATE INDEX IF NOT EXISTS idx_media_board_ts ON media_rank(board, ts DESC);

CREATE TABLE IF NOT EXISTS source_health (
  source      TEXT PRIMARY KEY,
  ok          INTEGER NOT NULL DEFAULT 0,
  adapter     TEXT NOT NULL DEFAULT '',
  items       INTEGER NOT NULL DEFAULT 0,
  latency_ms  INTEGER NOT NULL DEFAULT 0,
  checked_at  INTEGER NOT NULL DEFAULT 0,
  error       TEXT NOT NULL DEFAULT ''
);
