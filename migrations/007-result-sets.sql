CREATE TABLE domain_result_sets (
  digest text PRIMARY KEY
);
CREATE TABLE domain_set_results (
  digest text NOT NULL REFERENCES domain_result_sets,
  result_id bigint NOT NULL REFERENCES domain_results,
  PRIMARY KEY(digest,result_id)
);
CREATE TABLE domain_run_sets (
  run_id uuid PRIMARY KEY REFERENCES domain_runs,
  digest text NOT NULL REFERENCES domain_result_sets
);
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['domain_result_sets','domain_set_results','domain_run_sets'] LOOP
    EXECUTE format('CREATE TRIGGER ledger_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION immutable_ledger()',tab);
  END LOOP;
END; $$;
INSERT INTO schema_migrations(version) VALUES(7);
