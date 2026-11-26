CREATE TABLE forecast_corrections (
  run_id uuid NOT NULL,
  ticker text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  corrected_probability double precision NOT NULL CHECK (corrected_probability BETWEEN 0 AND 1),
  reason text NOT NULL,
  source text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (run_id,ticker,revision),
  FOREIGN KEY (run_id,ticker) REFERENCES predictions
);
CREATE TRIGGER ledger_immutable BEFORE UPDATE OR DELETE ON forecast_corrections
  FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
CREATE VIEW reconciled_forecasts AS
SELECT p.run_id,p.ticker,p.observation,
       c.revision,c.reason,c.source,c.recorded_at,c.corrected_probability,
       COALESCE(c.corrected_probability,(p.observation->>'probability')::double precision) AS reconciled_probability
FROM predictions p
LEFT JOIN LATERAL (SELECT * FROM forecast_corrections
   WHERE run_id=p.run_id AND ticker=p.ticker ORDER BY revision DESC LIMIT 1) c ON true;
INSERT INTO schema_migrations(version) VALUES(3);
