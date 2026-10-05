CREATE TABLE "chat_folder_seeds" (
	"user_id" text PRIMARY KEY NOT NULL,
	"seeded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_folders" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"icon" text NOT NULL,
	"position" integer NOT NULL,
	"include_types" text[] DEFAULT '{}' NOT NULL,
	"include_chats" text[] DEFAULT '{}' NOT NULL,
	"exclude_chats" text[] DEFAULT '{}' NOT NULL,
	"exclude_muted" boolean DEFAULT false NOT NULL,
	"exclude_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_folders_name_length_check" CHECK (char_length("chat_folders"."name") BETWEEN 1 AND 24)
);
--> statement-breakpoint
ALTER TABLE "chat_folder_seeds" ADD CONSTRAINT "chat_folder_seeds_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_folders" ADD CONSTRAINT "chat_folders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_folders_user_idx" ON "chat_folders" USING btree ("user_id");