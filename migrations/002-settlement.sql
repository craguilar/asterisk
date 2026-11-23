CREATE TABLE IF NOT EXISTS settlement_checks (
  run_id uuid NOT NULL REFERENCES runs(id),
  event text NOT NULL,
  attempts integer NOT NULL CHECK(attempts > 0),
  next_check_at timestamptz NOT NULL,
  lease uuid NOT NULL,
  reason text NOT NULL,
  PRIMARY KEY(run_id,event)
);
CREATE INDEX IF NOT EXISTS settlement_checks_due ON settlement_checks(next_check_at);
INSERT INTO schema_migrations(version) VALUES(2) ON CONFLICT DO NOTHING;
