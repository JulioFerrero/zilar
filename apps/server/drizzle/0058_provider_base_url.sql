SET lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "provider_connections" ADD COLUMN "base_url" text;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_base_url_length_check" CHECK ("base_url" IS NULL OR char_length("base_url") <= 300);
