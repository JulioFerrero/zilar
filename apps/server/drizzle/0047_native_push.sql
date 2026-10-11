ALTER TABLE "push_subscriptions" ADD COLUMN "kind" text DEFAULT 'webpush' NOT NULL;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "token" text;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ALTER COLUMN "endpoint" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ALTER COLUMN "p256dh" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ALTER COLUMN "auth" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_kind_check" CHECK ("kind" IN ('webpush', 'fcm', 'apns'));--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_shape_check" CHECK (("kind" = 'webpush' AND "endpoint" IS NOT NULL AND "p256dh" IS NOT NULL AND "auth" IS NOT NULL AND "token" IS NULL) OR ("kind" IN ('fcm', 'apns') AND "token" IS NOT NULL AND "endpoint" IS NULL AND "p256dh" IS NULL AND "auth" IS NULL));--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_user_token_idx" ON "push_subscriptions" ("user_id", "token") WHERE "token" IS NOT NULL;
