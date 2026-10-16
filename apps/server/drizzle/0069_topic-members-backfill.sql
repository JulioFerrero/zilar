-- T-1754 backfill: give every existing public topic its group's current
-- members as real `topic_members` rows. Julio's rule (2026-10-16) is that a
-- new public topic includes nobody until people join, so a public topic now
-- owns its member list instead of implying the whole group. General topics
-- stay everyone, so they are skipped (`is_general IS FALSE`), as are archived
-- topics. Idempotent: `ON CONFLICT DO NOTHING` leaves rows a person already
-- joined or that a private-then-public patch kept untouched.
SET lock_timeout = '5s';--> statement-breakpoint
INSERT INTO "topic_members" ("topic_id", "user_id", "added_by") SELECT t."id", gm."user_id", t."created_by" FROM "topics" t JOIN "group_members" gm ON gm."group_id" = t."group_id" WHERE t."visibility" = 'public' AND t."is_general" IS FALSE AND t."archived_at" IS NULL ON CONFLICT DO NOTHING;
