CREATE TABLE "chat_reads" (
	"user_id" text NOT NULL,
	"chat_jid" text NOT NULL,
	"last_read_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_reads_user_id_chat_jid_pk" PRIMARY KEY("user_id","chat_jid"),
	CONSTRAINT "chat_reads_jid_length_check" CHECK (char_length("chat_reads"."chat_jid") BETWEEN 1 AND 255)
);
--> statement-breakpoint
ALTER TABLE "chat_reads" ADD CONSTRAINT "chat_reads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_reads_user_idx" ON "chat_reads" USING btree ("user_id");
