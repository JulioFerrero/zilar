SET lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "last_failure" text;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_last_failure_check" CHECK ("last_failure" IS NULL OR length("last_failure") <= 64);
