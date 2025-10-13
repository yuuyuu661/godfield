CREATE TABLE IF NOT EXISTS tournament (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'Tournament',
  status TEXT NOT NULL DEFAULT 'registering', -- registering | live | finished
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  member1 TEXT,
  member2 TEXT,
  member3 TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS matches (
  id SERIAL PRIMARY KEY,
  round INT NOT NULL,        -- 1 = Round of N (初戦)
  position INT NOT NULL,     -- 同ラウンド内の並び順
  team_a INT REFERENCES teams(id) ON DELETE SET NULL,
  team_b INT REFERENCES teams(id) ON DELETE SET NULL,
  winner INT REFERENCES teams(id) ON DELETE SET NULL,
  next_match_id INT REFERENCES matches(id) ON DELETE SET NULL,
  next_is_a BOOLEAN,         -- 勝者は次の試合のA枠に入るか？
  UNIQUE(round, position)
);
