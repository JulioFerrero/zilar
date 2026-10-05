CREATE TABLE "routines" (
	"id" text PRIMARY KEY NOT NULL,
	"ai_id" text NOT NULL,
	"group_id" text,
	"topic_id" text,
	"tool_id" text NOT NULL,
	"title" text NOT NULL,
	"schedule" jsonb NOT NULL,
	"input" jsonb,
	"approved_hosts" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"paused_reason" text,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_status" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "routines_topic_scope_check" CHECK (("group_id" IS NULL) = ("topic_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_ai_id_ais_id_fk" FOREIGN KEY ("ai_id") REFERENCES "public"."ais"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_tool_id_ai_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."ai_tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "routines_status_next_run_idx" ON "routines" USING btree ("status","next_run_at");