-- D1 schema for SuikaDrop daily ranking
CREATE TABLE IF NOT EXISTS daily_scores (
  day TEXT NOT NULL,
  device_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  score INTEGER NOT NULL,
  client_version TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (day, device_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_scores_day_score
  ON daily_scores(day, score DESC, updated_at ASC);

