CREATE TABLE "ai_delegations" (
	"id" text PRIMARY KEY NOT NULL,
	"from_ai_id" text NOT NULL,
	"to_ai_id" text NOT NULL,
	"group_id" text NOT NULL,
	"topic_id" text,
	"objective" text NOT NULL,
	"context_summary" text,
	"acceptance" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"constraints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"artifacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"budget_currency" text,
	"budget_max" numeric(12, 2),
	"return_format" text,
	"reply_to" text,
	"status" text DEFAULT 'working' NOT NULL,
	"result_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_delegations_different_ais_check" CHECK ("ai_delegations"."from_ai_id" <> "ai_delegations"."to_ai_id"),
	CONSTRAINT "ai_delegations_status_check" CHECK ("ai_delegations"."status" IN ('working', 'completed', 'failed', 'canceled'))
);
--> statement-breakpoint
ALTER TABLE "ais" ADD COLUMN "can_delegate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ais" ADD COLUMN "accepts_delegation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "listener_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "listener_eagerness" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_delegations" ADD CONSTRAINT "ai_delegations_from_ai_id_ais_id_fk" FOREIGN KEY ("from_ai_id") REFERENCES "public"."ais"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_delegations" ADD CONSTRAINT "ai_delegations_to_ai_id_ais_id_fk" FOREIGN KEY ("to_ai_id") REFERENCES "public"."ais"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_delegations" ADD CONSTRAINT "ai_delegations_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_delegations" ADD CONSTRAINT "ai_delegations_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_delegations_to_status_idx" ON "ai_delegations" USING btree ("to_ai_id","status");--> statement-breakpoint
CREATE INDEX "ai_delegations_group_created_idx" ON "ai_delegations" USING btree ("group_id","created_at");--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_listener_eagerness_check" CHECK ("groups"."listener_eagerness" IN ('quiet', 'normal', 'eager'));