CREATE TABLE "xmpp_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"localpart" text NOT NULL,
	"jid" text NOT NULL,
	"provisioned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "xmpp_accounts_localpart_unique" UNIQUE("localpart"),
	CONSTRAINT "xmpp_accounts_jid_unique" UNIQUE("jid")
);
--> statement-breakpoint
ALTER TABLE "xmpp_accounts" ADD CONSTRAINT "xmpp_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;