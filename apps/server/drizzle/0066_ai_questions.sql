SET lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "ai_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"ai_id" text NOT NULL REFERENCES "ais"("id") ON DELETE CASCADE,
	"group_id" text,
	"topic_id" text,
	"room_jid" text NOT NULL,
	"message_id" text,
	"question" text NOT NULL,
	"options" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"answer" text,
	"answered_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone
);--> statement-breakpoint
CREATE INDEX "ai_questions_ai_status_idx" ON "ai_questions" USING btree ("ai_id","status");--> statement-breakpoint
CREATE INDEX "ai_questions_topic_status_idx" ON "ai_questions" USING btree ("topic_id","status");--> statement-breakpoint
CREATE INDEX "ai_questions_message_idx" ON "ai_questions" USING btree ("message_id");
