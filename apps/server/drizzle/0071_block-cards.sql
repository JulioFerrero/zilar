SET lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "block_cards" (
	"origin_id" text PRIMARY KEY NOT NULL,
	"stanza_id" text UNIQUE,
	"ai_id" text NOT NULL REFERENCES "ais"("id") ON DELETE CASCADE,
	"group_id" text,
	"topic_id" text,
	"room_jid" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "block_responses" (
	"card_id" text NOT NULL REFERENCES "block_cards"("origin_id") ON DELETE CASCADE,
	"block_id" text NOT NULL,
	"item_id" text DEFAULT '' NOT NULL,
	"actor_id" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	PRIMARY KEY ("card_id","block_id","item_id","actor_id")
);--> statement-breakpoint
CREATE INDEX "block_cards_room_jid_idx" ON "block_cards" USING btree ("room_jid");
