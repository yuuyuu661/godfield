-- ベーススキーマ（必要に応じて一度DROPしてから実行）
CREATE TABLE IF NOT EXISTS tournament (
  id SERIAL PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'registering', -- registering | seeding | live | finished
  created_at TIMESTAMP DEFAULT NOW()
);

-- 単一レコードを確保
INSERT INTO tournament (status)
SELECT 'registering'
WHERE NOT EXISTS (SELECT 1 FROM tournament);

CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  member1 TEXT DEFAULT '',
  member2 TEXT DEFAULT '',
  member3 TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW()
);

-- round: 1..log2(size)
-- position: round内での試合番号（1..）
CREATE TABLE IF NOT EXISTS matches (
  id SERIAL PRIMARY KEY,
  round INTEGER NOT NULL,
  position INTEGER NOT NULL,
  team_a INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  team_b INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  winner INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  next_match_id INTEGER,
  next_is_a BOOLEAN,
  UNIQUE(round, position)
);

CREATE INDEX IF NOT EXISTS idx_matches_round_pos ON matches(round, position);
