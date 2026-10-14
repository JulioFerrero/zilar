SET lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"ai_id" text NOT NULL,
	"day" date NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cached_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_write_tokens" bigint DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_ai_id_day_pk" PRIMARY KEY("ai_id","day")
);--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_ai_id_ais_id_fk" FOREIGN KEY ("ai_id") REFERENCES "public"."ais"("id") ON DELETE cascade ON UPDATE no action;
