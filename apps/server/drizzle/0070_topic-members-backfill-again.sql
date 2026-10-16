-- T-1757: re-run the T-1754 public-topic backfill (0069) once more. Anyone who
-- joined a group after 0069 ran but before the reads switched to the new rule
-- would be missing from a public topic's member list, so this closes that gap
-- between the two deploys. The statement is the same as 0069 and idempotent:
-- `ON CONFLICT DO NOTHING` leaves rows a person already has untouched, and
-- General (`is_general IS FALSE`) and archived topics stay skipped.
SET lock_timeout = '5s';--> statement-breakpoint
INSERT INTO "topic_members" ("topic_id", "user_id", "added_by") SELECT t."id", gm."user_id", t."created_by" FROM "topics" t JOIN "group_members" gm ON gm."group_id" = t."group_id" WHERE t."visibility" = 'public' AND t."is_general" IS FALSE AND t."archived_at" IS NULL ON CONFLICT DO NOTHING;
