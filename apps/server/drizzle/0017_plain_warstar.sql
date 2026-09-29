CREATE TABLE "ai_tool_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"tool_id" text NOT NULL,
	"version" integer NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"error_kind" text,
	"duration_ms" integer NOT NULL,
	"fetch_count" integer NOT NULL,
	"output_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_tool_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"tool_id" text NOT NULL,
	"version" integer NOT NULL,
	"source" text NOT NULL,
	"hosts" jsonb NOT NULL,
	"message" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_tools" (
	"id" text PRIMARY KEY NOT NULL,
	"ai_id" text NOT NULL,
	"group_id" text,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ai_tool_runs" ADD CONSTRAINT "ai_tool_runs_tool_id_ai_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."ai_tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_tool_versions" ADD CONSTRAINT "ai_tool_versions_tool_id_ai_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."ai_tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_tool_versions" ADD CONSTRAINT "ai_tool_versions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_tools" ADD CONSTRAINT "ai_tools_ai_id_ais_id_fk" FOREIGN KEY ("ai_id") REFERENCES "public"."ais"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_tools" ADD CONSTRAINT "ai_tools_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_tools" ADD CONSTRAINT "ai_tools_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_tool_runs_tool_idx" ON "ai_tool_runs" USING btree ("tool_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_tool_versions_tool_version_idx" ON "ai_tool_versions" USING btree ("tool_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_tools_active_personal_idx" ON "ai_tools" USING btree ("ai_id","name") WHERE "ai_tools"."deleted_at" IS NULL AND "ai_tools"."group_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_tools_active_group_idx" ON "ai_tools" USING btree ("ai_id","group_id","name") WHERE "ai_tools"."deleted_at" IS NULL AND "ai_tools"."group_id" IS NOT NULL;