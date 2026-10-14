SET lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "ai_limits" ALTER COLUMN "per_day_usd" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_limits" ALTER COLUMN "per_month_usd" DROP NOT NULL;
