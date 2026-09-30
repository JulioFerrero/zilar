DROP INDEX "ai_tools_active_group_idx";--> statement-breakpoint
DROP INDEX "approval_rules_active_group_idx";--> statement-breakpoint
ALTER TABLE "ai_tools" ADD COLUMN "topic_id" text;--> statement-breakpoint
ALTER TABLE "approval_rules" ADD COLUMN "topic_id" text;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "topic_id" text;--> statement-breakpoint
ALTER TABLE "pending_actions" ADD COLUMN "topic_id" text;--> statement-breakpoint
ALTER TABLE "ai_tools" ADD CONSTRAINT "ai_tools_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_tools_active_topic_idx" ON "ai_tools" USING btree ("ai_id","topic_id","name") WHERE "ai_tools"."deleted_at" IS NULL AND "ai_tools"."topic_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_rules_active_topic_idx" ON "approval_rules" USING btree ("ai_id","topic_id","action") WHERE "approval_rules"."revoked_at" IS NULL AND "approval_rules"."topic_id" IS NOT NULL;