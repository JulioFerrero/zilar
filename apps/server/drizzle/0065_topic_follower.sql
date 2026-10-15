SET lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "follower_ai_id" text REFERENCES "ais"("id") ON DELETE SET NULL;--> statement-breakpoint
UPDATE "topics" SET "follower_ai_id" = "owner_ai_id" WHERE "owner_ai_id" IS NOT NULL AND "is_general" = false;
