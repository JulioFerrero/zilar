SET lock_timeout = '5s';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_task_events_status_idx" ON "agent_task_events" ("chat_jid", "ai_id", "at") WHERE "kind" = 'status';
