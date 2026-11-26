CREATE TABLE run_publications (
  run_id uuid PRIMARY KEY REFERENCES runs,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER ledger_immutable BEFORE UPDATE OR DELETE ON run_publications
  FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
INSERT INTO schema_migrations(version) VALUES(6);
