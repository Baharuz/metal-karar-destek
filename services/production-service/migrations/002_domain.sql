ALTER TABLE machines ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE machines ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
UPDATE machines SET code = UPPER(BTRIM(code)), name = BTRIM(name)
WHERE code <> UPPER(BTRIM(code)) OR name <> BTRIM(name);
ALTER TABLE machines ADD CONSTRAINT machines_code_normalized CHECK (code = UPPER(BTRIM(code)) AND LENGTH(code) > 0);
ALTER TABLE machines ADD CONSTRAINT machines_name_present CHECK (LENGTH(BTRIM(name)) > 0);
CREATE UNIQUE INDEX machines_code_normalized_unique ON machines (UPPER(BTRIM(code)));
CREATE INDEX machines_active_status_idx ON machines (status, id) WHERE archived_at IS NULL;

CREATE TABLE machine_status_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  machine_id BIGINT NOT NULL REFERENCES machines(id) ON DELETE RESTRICT,
  previous_status VARCHAR(20) CHECK (previous_status IN ('idle', 'running', 'maintenance')),
  new_status VARCHAR(20) NOT NULL CHECK (new_status IN ('idle', 'running', 'maintenance')),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX machine_status_history_machine_time_idx ON machine_status_history (machine_id, changed_at DESC, id DESC);
INSERT INTO machine_status_history (machine_id, previous_status, new_status, changed_at, note)
SELECT id, NULL, status, created_at, 'Geçiş sırasında kayıtlı durum' FROM machines;

CREATE TABLE machine_measurements (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  machine_id BIGINT NOT NULL REFERENCES machines(id) ON DELETE RESTRICT,
  kind VARCHAR(32) NOT NULL CHECK (kind IN ('temperature_c', 'vibration_mm_s', 'runtime_hours')),
  value NUMERIC(14,3) NOT NULL CHECK (value >= 0),
  unit VARCHAR(8) NOT NULL,
  measured_at TIMESTAMPTZ NOT NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'demo')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT measurement_unit_matches_kind CHECK (
    (kind = 'temperature_c' AND unit = '°C') OR
    (kind = 'vibration_mm_s' AND unit = 'mm/s') OR
    (kind = 'runtime_hours' AND unit = 'h')
  )
);
CREATE INDEX machine_measurements_machine_kind_time_idx ON machine_measurements (machine_id, kind, measured_at DESC, id DESC);
CREATE INDEX machine_measurements_time_idx ON machine_measurements (measured_at DESC);

CREATE TABLE machine_thresholds (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  machine_id BIGINT NOT NULL REFERENCES machines(id) ON DELETE RESTRICT,
  kind VARCHAR(32) NOT NULL CHECK (kind IN ('temperature_c', 'vibration_mm_s', 'runtime_hours')),
  unit VARCHAR(8) NOT NULL,
  warning_value NUMERIC(14,3) NOT NULL CHECK (warning_value >= 0),
  critical_value NUMERIC(14,3) NOT NULL CHECK (critical_value > warning_value),
  is_demo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (machine_id, kind),
  CONSTRAINT threshold_unit_matches_kind CHECK (
    (kind = 'temperature_c' AND unit = '°C') OR
    (kind = 'vibration_mm_s' AND unit = 'mm/s') OR
    (kind = 'runtime_hours' AND unit = 'h')
  )
);

CREATE TABLE maintenance_records (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  machine_id BIGINT NOT NULL REFERENCES machines(id) ON DELETE RESTRICT,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('preventive', 'corrective', 'inspection')),
  status VARCHAR(20) NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'completed')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  description TEXT NOT NULL CHECK (LENGTH(BTRIM(description)) > 0),
  action_taken TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((status = 'planned' AND completed_at IS NULL) OR
         (status = 'completed' AND completed_at IS NOT NULL AND LENGTH(BTRIM(action_taken)) > 0))
);
CREATE INDEX maintenance_machine_schedule_idx ON maintenance_records (machine_id, scheduled_at DESC);
CREATE INDEX maintenance_planned_idx ON maintenance_records (scheduled_at) WHERE status = 'planned';

CREATE TABLE products (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE CHECK (code = UPPER(BTRIM(code)) AND LENGTH(code) > 0),
  name VARCHAR(100) NOT NULL CHECK (LENGTH(BTRIM(name)) > 0),
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE production_batches (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  machine_id BIGINT NOT NULL REFERENCES machines(id) ON DELETE RESTRICT,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  total_count INTEGER NOT NULL CHECK (total_count >= 0),
  defective_count INTEGER NOT NULL CHECK (defective_count >= 0 AND defective_count <= total_count),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE INDEX production_batches_machine_time_idx ON production_batches (machine_id, started_at DESC);
CREATE INDEX production_batches_product_time_idx ON production_batches (product_id, started_at DESC);

-- count is the number of affected parts with this defect type. The same part
-- can appear in several defect types, so SUM(count) may exceed defective_count.
CREATE TABLE quality_records (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id BIGINT NOT NULL REFERENCES production_batches(id) ON DELETE RESTRICT,
  kind VARCHAR(40) NOT NULL CHECK (kind IN ('burr', 'surface_defect', 'dimension_out_of_tolerance')),
  count INTEGER NOT NULL CHECK (count > 0),
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX quality_records_batch_idx ON quality_records (batch_id, created_at DESC);

CREATE TABLE alerts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  machine_id BIGINT NOT NULL REFERENCES machines(id) ON DELETE RESTRICT,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('measurement', 'maintenance', 'quality')),
  metric VARCHAR(40),
  dedup_key VARCHAR(100) NOT NULL CHECK (LENGTH(BTRIM(dedup_key)) > 0),
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('warning', 'critical')),
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved')),
  title TEXT NOT NULL CHECK (LENGTH(BTRIM(title)) > 0),
  explanation TEXT NOT NULL DEFAULT '',
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved_at TIMESTAMPTZ,
  resolution_reason TEXT,
  resolved_by_maintenance_id BIGINT REFERENCES maintenance_records(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((status = 'resolved' AND resolved_at IS NOT NULL AND LENGTH(BTRIM(resolution_reason)) > 0)
    OR (status <> 'resolved' AND resolved_at IS NULL AND resolution_reason IS NULL AND resolved_by_maintenance_id IS NULL))
);
CREATE UNIQUE INDEX alerts_one_active_condition_idx ON alerts (machine_id, dedup_key) WHERE status IN ('open', 'reviewing');
CREATE INDEX alerts_machine_status_idx ON alerts (machine_id, status, created_at DESC);

CREATE FUNCTION set_row_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;
CREATE TRIGGER machines_updated_at BEFORE UPDATE ON machines FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();
CREATE TRIGGER thresholds_updated_at BEFORE UPDATE ON machine_thresholds FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();
CREATE TRIGGER maintenance_updated_at BEFORE UPDATE ON maintenance_records FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();
CREATE TRIGGER products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();
CREATE TRIGGER batches_updated_at BEFORE UPDATE ON production_batches FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();
CREATE TRIGGER alerts_updated_at BEFORE UPDATE ON alerts FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();
