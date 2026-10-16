SET lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "routines" ADD COLUMN "kind" text DEFAULT 'tool' NOT NULL;--> statement-breakpoint
ALTER TABLE "routines" ALTER COLUMN "tool_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "routines" ADD COLUMN "prompt" text;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_kind_check" CHECK ("kind" IN ('tool', 'prompt'));--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_tool_kind_needs_tool" CHECK (("kind" = 'tool') = ("tool_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_prompt_kind_needs_prompt" CHECK (("kind" = 'prompt') = ("prompt" IS NOT NULL));--> statement-breakpoint
CREATE TABLE "routine_prompt_runs" (
	"ai_id" text NOT NULL REFERENCES "ais"("id") ON DELETE CASCADE,
	"day" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	PRIMARY KEY ("ai_id", "day")
);
