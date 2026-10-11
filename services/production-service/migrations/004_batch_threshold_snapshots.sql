-- The thresholds used for a completed batch are frozen when the batch is
-- registered. Existing batches receive the best available migration-time
-- snapshot; later threshold edits do not rewrite their analysis.
CREATE TABLE batch_threshold_snapshots (
  batch_id BIGINT NOT NULL REFERENCES production_batches(id) ON DELETE RESTRICT,
  kind VARCHAR(32) NOT NULL CHECK (kind IN ('temperature_c', 'vibration_mm_s', 'runtime_hours')),
  unit VARCHAR(8) NOT NULL,
  warning_value NUMERIC(14,3) NOT NULL CHECK (warning_value >= 0),
  critical_value NUMERIC(14,3) NOT NULL CHECK (critical_value > warning_value),
  is_demo BOOLEAN NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (batch_id, kind)
);

INSERT INTO batch_threshold_snapshots (batch_id, kind, unit, warning_value, critical_value, is_demo)
SELECT b.id, t.kind, t.unit, t.warning_value, t.critical_value, t.is_demo
FROM production_batches b
JOIN machine_thresholds t ON t.machine_id = b.machine_id;

CREATE FUNCTION capture_batch_thresholds() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO batch_threshold_snapshots (batch_id, kind, unit, warning_value, critical_value, is_demo)
  SELECT NEW.id, t.kind, t.unit, t.warning_value, t.critical_value, t.is_demo
  FROM machine_thresholds t WHERE t.machine_id = NEW.machine_id;
  RETURN NEW;
END; $$;

CREATE TRIGGER batches_capture_thresholds
AFTER INSERT ON production_batches
FOR EACH ROW EXECUTE FUNCTION capture_batch_thresholds();
