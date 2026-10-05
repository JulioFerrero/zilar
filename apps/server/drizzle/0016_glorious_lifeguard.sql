CREATE TABLE "approval_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"ai_id" text NOT NULL,
	"group_id" text,
	"action" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text
);
--> statement-breakpoint
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_ai_id_ais_id_fk" FOREIGN KEY ("ai_id") REFERENCES "public"."ais"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_rules_active_group_idx" ON "approval_rules" USING btree ("ai_id","group_id","action") WHERE "approval_rules"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_rules_active_personal_idx" ON "approval_rules" USING btree ("ai_id","action") WHERE "approval_rules"."revoked_at" IS NULL AND "approval_rules"."group_id" IS NULL;