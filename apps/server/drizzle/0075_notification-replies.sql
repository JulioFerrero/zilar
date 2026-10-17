SET lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "notification_replies" (
	"user_id" text NOT NULL,
	"client_id" text NOT NULL,
	"chat_jid" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "notification_replies_pk" PRIMARY KEY("user_id","client_id")
);
