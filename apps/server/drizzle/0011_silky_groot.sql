CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"ai_id" text NOT NULL,
	"group_id" text,
	"action" text NOT NULL,
	"summary" text NOT NULL,
	"details" text,
	"args_hash" text NOT NULL,
	"worst_case_currency" text,
	"worst_case_amount" numeric(12, 2),
	"requested_by" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"note" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_ai_id_ais_id_fk" FOREIGN KEY ("ai_id") REFERENCES "public"."ais"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_ai_status_idx" ON "approvals" USING btree ("ai_id","status");--> statement-breakpoint
CREATE INDEX "approvals_group_status_idx" ON "approvals" USING btree ("group_id","status");