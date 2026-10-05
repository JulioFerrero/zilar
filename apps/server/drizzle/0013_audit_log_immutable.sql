-- audit_log is append-only (PROJECT_PLAN §15.5). Reject UPDATE, DELETE and
-- TRUNCATE at the database so a bug, a service account or a hand-typed
-- query cannot rewrite history. The trigger covers PGlite (used by tests)
-- and Postgres (used in production): both speak plpgsql.
CREATE OR REPLACE FUNCTION audit_log_block_mutations() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_log;
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutations();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutations();
--> statement-breakpoint
-- Statement-level (no row) because TRUNCATE has no row to attach to.
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_block_mutations();