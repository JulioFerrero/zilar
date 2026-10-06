CREATE TABLE "media_index_state" (
	"archive_owner" text NOT NULL,
	"chat_jid" text NOT NULL,
	"indexed_through_micros" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_index_state_archive_owner_chat_jid_pk" PRIMARY KEY("archive_owner","chat_jid")
);
--> statement-breakpoint
CREATE TABLE "media_items" (
	"id" text PRIMARY KEY NOT NULL,
	"archive_owner" text NOT NULL,
	"chat_jid" text NOT NULL,
	"message_id" text NOT NULL,
	"at_micros" bigint NOT NULL,
	"sender_jid" text NOT NULL,
	"kind" text NOT NULL,
	"url" text,
	"name" text,
	"mime" text,
	"size" integer,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"waveform" jsonb,
	"link_url" text,
	"link_host" text,
	"ref" text NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "media_items_unique_idx" ON "media_items" USING btree ("archive_owner","chat_jid","message_id","kind","ref");--> statement-breakpoint
CREATE INDEX "media_items_chat_kind_at_idx" ON "media_items" USING btree ("archive_owner","chat_jid","kind","at_micros");