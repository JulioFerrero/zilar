CREATE TABLE "ai_daily_spend" (
	"ai_id" text NOT NULL,
	"day" date NOT NULL,
	"baseline_usd" numeric(12, 2) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_daily_spend_ai_id_day_pk" PRIMARY KEY("ai_id","day")
);
--> statement-breakpoint
ALTER TABLE "ai_daily_spend" ADD CONSTRAINT "ai_daily_spend_ai_id_ais_id_fk" FOREIGN KEY ("ai_id") REFERENCES "public"."ais"("id") ON DELETE cascade ON UPDATE no action;