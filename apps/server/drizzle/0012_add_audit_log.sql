CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" text,
	"ai_id" text,
	"group_id" text,
	"action" text NOT NULL,
	"subject_id" text,
	"args_hash" text,
	"cost_currency" text,
	"cost_amount" numeric(12, 2),
	"result" text NOT NULL,
	"detail" jsonb
);
--> statement-breakpoint
CREATE INDEX "audit_log_group_at_idx" ON "audit_log" USING btree ("group_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_ai_at_idx" ON "audit_log" USING btree ("ai_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_at_idx" ON "audit_log" USING btree ("actor_user_id","at");