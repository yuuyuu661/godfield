CREATE TABLE IF NOT EXISTS entries (
  id SERIAL PRIMARY KEY,
  team_name TEXT NOT NULL,
  member1 TEXT,
  member2 TEXT,
  member3 TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
