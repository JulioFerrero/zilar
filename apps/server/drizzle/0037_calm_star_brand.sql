CREATE TABLE "avatars" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_kind" text NOT NULL,
	"owner_id" text NOT NULL,
	"mime" text NOT NULL,
	"width" integer,
	"height" integer,
	"bytes" integer,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "avatars_owner_kind_check" CHECK ("avatars"."owner_kind" IN ('user', 'ai', 'group')),
	CONSTRAINT "avatars_mime_check" CHECK ("avatars"."mime" IN ('image/webp', 'image/png'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "avatars_owner_idx" ON "avatars" USING btree ("owner_kind","owner_id");