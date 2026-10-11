-- First migration matches the table shipped in the original ZIP. It does not
-- drop or recreate an existing installation.
CREATE TABLE IF NOT EXISTS machines (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle', 'running', 'maintenance')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
