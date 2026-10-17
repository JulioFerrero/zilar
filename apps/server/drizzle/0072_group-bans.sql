SET lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "group_bans" (
	"group_id" text NOT NULL REFERENCES "groups"("id") ON DELETE CASCADE,
	"user_id" text NOT NULL,
	"banned_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_bans_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
