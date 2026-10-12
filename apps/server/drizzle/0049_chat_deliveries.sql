CREATE TABLE "chat_deliveries" (
	"user_id" text NOT NULL,
	"chat_jid" text NOT NULL,
	"delivered_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_deliveries_user_id_chat_jid_pk" PRIMARY KEY("user_id","chat_jid"),
	CONSTRAINT "chat_deliveries_jid_length_check" CHECK (char_length("chat_deliveries"."chat_jid") BETWEEN 1 AND 255)
);
--> statement-breakpoint
ALTER TABLE "chat_deliveries" ADD CONSTRAINT "chat_deliveries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_deliveries_chat_jid_idx" ON "chat_deliveries" USING btree ("chat_jid");
