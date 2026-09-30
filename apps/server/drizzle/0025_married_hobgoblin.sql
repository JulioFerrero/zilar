CREATE TABLE "pinned_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_jid" text NOT NULL,
	"message_id" text NOT NULL,
	"sender_name" text NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'text' NOT NULL,
	"pinned_by" text NOT NULL,
	"pinned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pinned_messages" ADD CONSTRAINT "pinned_messages_pinned_by_user_id_fk" FOREIGN KEY ("pinned_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pinned_messages_chat_message_idx" ON "pinned_messages" USING btree ("chat_jid","message_id");--> statement-breakpoint
CREATE INDEX "pinned_messages_chat_idx" ON "pinned_messages" USING btree ("chat_jid");