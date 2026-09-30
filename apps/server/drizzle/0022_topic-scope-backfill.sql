-- T-0110 backfill: every action-pipeline row that names a group moves into
-- that group's General topic. A group always has exactly one General topic
-- (`topics_general_idx`), so the sub-select below finds exactly one row per
-- group. Personal-chat rows (`group_id IS NULL`) keep `topic_id NULL`.
-- After the backfill the scope CHECK constraints go on: personal scope is
-- both ids null, group scope is both set, and a row with exactly one of them
-- is rejected. The statement order is backfill first, constraints second, so
-- a pre-T-0110 database with group rows migrates cleanly. Idempotent: the
-- UPDATEs touch only rows with `topic_id IS NULL`, and the constraints are
-- added only when missing (the `DO` blocks keep a re-run after a partial
-- failure safe).
UPDATE "approvals" SET "topic_id" = (
  SELECT "topics"."id" FROM "topics"
  WHERE "topics"."group_id" = "approvals"."group_id" AND "topics"."is_general" IS TRUE
) WHERE "approvals"."group_id" IS NOT NULL AND "approvals"."topic_id" IS NULL;
--> statement-breakpoint
UPDATE "pending_actions" SET "topic_id" = (
  SELECT "topics"."id" FROM "topics"
  WHERE "topics"."group_id" = "pending_actions"."group_id" AND "topics"."is_general" IS TRUE
) WHERE "pending_actions"."group_id" IS NOT NULL AND "pending_actions"."topic_id" IS NULL;
--> statement-breakpoint
UPDATE "approval_rules" SET "topic_id" = (
  SELECT "topics"."id" FROM "topics"
  WHERE "topics"."group_id" = "approval_rules"."group_id" AND "topics"."is_general" IS TRUE
) WHERE "approval_rules"."group_id" IS NOT NULL AND "approval_rules"."topic_id" IS NULL;
--> statement-breakpoint
UPDATE "ai_tools" SET "topic_id" = (
  SELECT "topics"."id" FROM "topics"
  WHERE "topics"."group_id" = "ai_tools"."group_id" AND "topics"."is_general" IS TRUE
) WHERE "ai_tools"."group_id" IS NOT NULL AND "ai_tools"."topic_id" IS NULL;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint" WHERE "conname" = 'ai_tools_topic_scope_check'
  ) THEN
    ALTER TABLE "ai_tools" ADD CONSTRAINT "ai_tools_topic_scope_check"
      CHECK (("group_id" IS NULL) = ("topic_id" IS NULL));
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint" WHERE "conname" = 'approval_rules_topic_scope_check'
  ) THEN
    ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_topic_scope_check"
      CHECK (("group_id" IS NULL) = ("topic_id" IS NULL));
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint" WHERE "conname" = 'approvals_topic_scope_check'
  ) THEN
    ALTER TABLE "approvals" ADD CONSTRAINT "approvals_topic_scope_check"
      CHECK (("group_id" IS NULL) = ("topic_id" IS NULL));
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint" WHERE "conname" = 'pending_actions_topic_scope_check'
  ) THEN
    ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_topic_scope_check"
      CHECK (("group_id" IS NULL) = ("topic_id" IS NULL));
  END IF;
END $$;
