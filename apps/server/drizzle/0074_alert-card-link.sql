SET lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "routines" ADD COLUMN "alert_card_id" text, ADD COLUMN "alert_block_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "routines_alert_card_idx" ON "routines" ("alert_card_id", "alert_block_id") WHERE "alert_card_id" IS NOT NULL AND "deleted_at" IS NULL;
