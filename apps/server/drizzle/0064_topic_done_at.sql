SET lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "done_at" timestamptz;
