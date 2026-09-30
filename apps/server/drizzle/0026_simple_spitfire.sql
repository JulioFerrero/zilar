CREATE TABLE "group_invite_links" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_hint" text NOT NULL,
	"label" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "group_invite_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "group_invite_links" ADD CONSTRAINT "group_invite_links_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_invite_links" ADD CONSTRAINT "group_invite_links_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_invite_links_group_idx" ON "group_invite_links" USING btree ("group_id");