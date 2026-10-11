-- Demo seed is opt-in, transactional and safe to repeat. This marker is never
-- used by normal application writes.
CREATE TABLE demo_seed_runs (
  name TEXT PRIMARY KEY CHECK (LENGTH(BTRIM(name)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
