CREATE TABLE "ai_limits" (
	"ai_id" text PRIMARY KEY NOT NULL,
	"per_day_usd" numeric(12, 2) NOT NULL,
	"per_month_usd" numeric(12, 2) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ais" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"template" text NOT NULL,
	"persona" text NOT NULL,
	"provider_connection_id" text NOT NULL,
	"model" text NOT NULL,
	"localpart" text NOT NULL,
	"jid" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ais_localpart_unique" UNIQUE("localpart"),
	CONSTRAINT "ais_jid_unique" UNIQUE("jid")
);
--> statement-breakpoint
CREATE TABLE "llm_virtual_keys" (
	"ai_id" text PRIMARY KEY NOT NULL,
	"litellm_key_id" text NOT NULL,
	"encrypted_key" text NOT NULL,
	"budget_usd" numeric(12, 2) NOT NULL,
	"budget_duration" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_limits" ADD CONSTRAINT "ai_limits_ai_id_ais_id_fk" FOREIGN KEY ("ai_id") REFERENCES "public"."ais"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ais" ADD CONSTRAINT "ais_owner_user_id_fk" FOREIGN KEY ("owner") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ais" ADD CONSTRAINT "ais_provider_connection_id_provider_connections_id_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_virtual_keys" ADD CONSTRAINT "llm_virtual_keys_ai_id_ais_id_fk" FOREIGN KEY ("ai_id") REFERENCES "public"."ais"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ais_owner_idx" ON "ais" USING btree ("owner");