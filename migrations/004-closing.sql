CREATE TABLE IF NOT EXISTS closing_observations (
  run_id uuid NOT NULL,
  ticker text NOT NULL,
  close_prior double precision NOT NULL CHECK(close_prior BETWEEN 0 AND 1),
  candle_end_at timestamptz NOT NULL,
  quotes jsonb NOT NULL CHECK(jsonb_typeof(quotes)='array' AND jsonb_array_length(quotes)=3),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(run_id,ticker),
  FOREIGN KEY(run_id,ticker) REFERENCES settlements(run_id,ticker)
);
DO $$ BEGIN
  IF NOT EXISTS(SELECT FROM pg_trigger WHERE tgrelid='closing_observations'::regclass AND tgname='ledger_immutable') THEN
    CREATE TRIGGER ledger_immutable BEFORE UPDATE OR DELETE ON closing_observations
      FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
  END IF;
END; $$;
CREATE OR REPLACE VIEW effective_settlements AS
  SELECT s.run_id,s.ticker,s.outcome,COALESCE(c.close_prior,s.close_prior) AS close_prior,s.source,s.settled_at
  FROM settlements s LEFT JOIN closing_observations c USING(run_id,ticker);
INSERT INTO schema_migrations(version) VALUES(4) ON CONFLICT DO NOTHING;
