SET lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "routines" ADD COLUMN "last_message_id" text;--> statement-breakpoint
ALTER TABLE "routines" ADD COLUMN "last_message_at" timestamp with time zone;
