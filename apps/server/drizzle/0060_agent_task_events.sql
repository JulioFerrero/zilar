SET lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "agent_task_events" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"ai_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"chat_jid" text NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"duration_ms" integer,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "agent_task_events_seq_unique" UNIQUE("task_id","seq")
);--> statement-breakpoint
ALTER TABLE "agent_task_events" ADD CONSTRAINT "agent_task_events_ai_id_ais_id_fk" FOREIGN KEY ("ai_id") REFERENCES "ais"("id") ON DELETE CASCADE ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_task_events_task_idx" ON "agent_task_events" ("task_id","seq");--> statement-breakpoint
CREATE INDEX "agent_task_events_at_idx" ON "agent_task_events" ("at");
