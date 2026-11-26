-- Immutable coefficients are shared by fits that learned the same parameters. Run-specific
-- cutoffs and provenance belong to the capture, including runs with zero listed markets.
CREATE TABLE domain_ratings (
  version text PRIMARY KEY,
  parameters jsonb NOT NULL CHECK (jsonb_typeof(parameters->'teams')='object')
);
CREATE TABLE domain_runs (
  run_id uuid PRIMARY KEY REFERENCES runs,
  forecast_at timestamptz NOT NULL,
  version text REFERENCES domain_ratings,
  fitted_as_of timestamptz, trained_through timestamptz, sample_count integer CHECK(sample_count>=0),
  results_coverage text NOT NULL,
  CHECK (trained_through IS NULL OR trained_through < fitted_as_of)
);
CREATE TABLE domain_results (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, observation jsonb NOT NULL UNIQUE
);
CREATE TABLE domain_run_results (
  run_id uuid REFERENCES domain_runs, result_id bigint REFERENCES domain_results,
  PRIMARY KEY(run_id,result_id)
);
CREATE TABLE domain_evidence (
  run_id uuid REFERENCES domain_runs, dataset text NOT NULL
  CHECK(dataset IN ('matches','goals','lineups','flags','availability','sources')),
  identity text NOT NULL, record jsonb NOT NULL, PRIMARY KEY(run_id,dataset,identity)
);
CREATE VIEW domain_decisions AS SELECT p.run_id,p.ticker,p.observation->>'decision' AS decision,
  p.observation->>'reason' AS reason,(p.observation->>'stake')::float8 AS stake,
  (p.observation->>'contracts')::int AS contracts,(p.observation->>'edge')::float8 AS edge FROM predictions p;
CREATE VIEW domain_price_snapshots AS SELECT p.run_id,p.ticker,p.observation->>'source' AS source,
  p.observation->>'event' AS event,p.observation->>'updated' AS observed_at,
  p.observation->>'marketStatus' AS status,(p.observation->>'ask')::float8 AS ask,
  (p.observation->>'bid')::float8 AS bid,(p.observation->>'last')::float8 AS last,
  (p.observation->>'volume')::float8 AS volume,(p.observation->>'askSize')::float8 AS ask_size FROM predictions p;
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['domain_ratings','domain_runs','domain_results','domain_run_results','domain_evidence'] LOOP
    EXECUTE format('CREATE TRIGGER domain_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION immutable_ledger()',tab);
  END LOOP;
END; $$;
INSERT INTO schema_migrations(version) VALUES(5);
