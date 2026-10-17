SET lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "card_media" (
	"id" text PRIMARY KEY NOT NULL,
	"ai_id" text NOT NULL REFERENCES "ais"("id") ON DELETE CASCADE,
	"room_jid" text NOT NULL,
	"group_id" text,
	"topic_id" text,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"width" integer,
	"height" integer,
	"name" text NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "card_media_ai_created_idx" ON "card_media" USING btree ("ai_id","created_at");
