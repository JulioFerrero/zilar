CREATE TABLE "pending_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"approval_id" text NOT NULL,
	"ai_id" text NOT NULL,
	"group_id" text,
	"action" text NOT NULL,
	"args" jsonb NOT NULL,
	"args_hash" text NOT NULL,
	"requested_by" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"result_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "pending_actions_approval_id_unique" UNIQUE("approval_id")
);
--> statement-breakpoint
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_ai_id_ais_id_fk" FOREIGN KEY ("ai_id") REFERENCES "public"."ais"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pending_actions_status_idx" ON "pending_actions" USING btree ("status");