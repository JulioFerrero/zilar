CREATE TABLE "chat_prefs" (
	"user_id" text NOT NULL,
	"chat_jid" text NOT NULL,
	"muted_until" timestamp with time zone,
	"archived" boolean DEFAULT false NOT NULL,
	"pinned_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_prefs_user_id_chat_jid_pk" PRIMARY KEY("user_id","chat_jid"),
	CONSTRAINT "chat_prefs_jid_length_check" CHECK (char_length("chat_prefs"."chat_jid") BETWEEN 1 AND 255)
);
--> statement-breakpoint
ALTER TABLE "chat_prefs" ADD CONSTRAINT "chat_prefs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_prefs_user_idx" ON "chat_prefs" USING btree ("user_id");