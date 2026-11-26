CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, applied_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS runs (
  id uuid PRIMARY KEY, mode text NOT NULL CHECK(mode IN ('live','replay','demo')),
  run_day date NOT NULL, attempted_at timestamptz NOT NULL DEFAULT now(),
  card jsonb NOT NULL, CHECK (card->>'mode'=mode)
);
CREATE INDEX IF NOT EXISTS runs_day ON runs(mode,run_day DESC,attempted_at DESC);
CREATE TABLE IF NOT EXISTS predictions (
  run_id uuid NOT NULL REFERENCES runs, ticker text NOT NULL, observation jsonb NOT NULL,
  PRIMARY KEY(run_id,ticker)
);
CREATE TABLE IF NOT EXISTS settlements (
  run_id uuid NOT NULL, ticker text NOT NULL, outcome integer NOT NULL CHECK(outcome IN (0,1)),
  close_prior double precision CHECK(close_prior BETWEEN 0 AND 1), source text NOT NULL,
  settled_at timestamptz NOT NULL, PRIMARY KEY(run_id,ticker),
  FOREIGN KEY(run_id,ticker) REFERENCES predictions
);
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY, principal text NOT NULL, mode text NOT NULL, revision integer NOT NULL DEFAULT 0,
  previous_tool text, expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days'
);
CREATE TABLE IF NOT EXISTS turns (
  session_id uuid NOT NULL REFERENCES sessions ON DELETE CASCADE, revision integer NOT NULL,
  tool text NOT NULL, answer text NOT NULL, run_id uuid REFERENCES runs, created_at timestamptz DEFAULT now(),
  PRIMARY KEY(session_id,revision)
);
CREATE TABLE IF NOT EXISTS tool_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, session_id uuid NOT NULL, principal text NOT NULL,
  tool text NOT NULL, status text NOT NULL, input_hash text NOT NULL, duration_ms integer NOT NULL, created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS quota(principal text NOT NULL, day date NOT NULL, runs integer NOT NULL, PRIMARY KEY(principal,day));
CREATE TABLE IF NOT EXISTS weight_versions(seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, version text NOT NULL UNIQUE, model jsonb NOT NULL);
CREATE OR REPLACE FUNCTION immutable_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'immutable ledger'; END; $$;
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['runs','predictions','settlements','tool_audit','weight_versions'] LOOP
    IF NOT EXISTS(SELECT FROM pg_trigger WHERE tgrelid=tab::regclass AND tgname='ledger_immutable') THEN
      EXECUTE format('CREATE TRIGGER ledger_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION immutable_ledger()',tab);
    END IF;
  END LOOP;
END; $$;
INSERT INTO schema_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;
