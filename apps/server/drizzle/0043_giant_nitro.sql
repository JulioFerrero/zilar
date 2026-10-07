CREATE TABLE "chat_background_defaults" (
	"user_id" text PRIMARY KEY NOT NULL,
	"background_preset" text,
	"background_image_id" text,
	"background_dim" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_background_defaults_preset_check" CHECK ("chat_background_defaults"."background_preset" IS NULL OR "chat_background_defaults"."background_preset" IN ('slate', 'gold', 'blue', 'navy', 'forest', 'wine', 'amber')),
	CONSTRAINT "chat_background_defaults_dim_check" CHECK ("chat_background_defaults"."background_dim" IS NULL OR "chat_background_defaults"."background_dim" BETWEEN 0 AND 80),
	CONSTRAINT "chat_background_defaults_exclusive_check" CHECK (NOT ("chat_background_defaults"."background_preset" IS NOT NULL AND "chat_background_defaults"."background_image_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "chat_backgrounds" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"mime" text NOT NULL,
	"width" integer,
	"height" integer,
	"bytes" integer,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_backgrounds_mime_check" CHECK ("chat_backgrounds"."mime" IN ('image/webp', 'image/png'))
);
--> statement-breakpoint
ALTER TABLE "chat_prefs" ADD COLUMN "background_preset" text;--> statement-breakpoint
ALTER TABLE "chat_prefs" ADD COLUMN "background_image_id" text;--> statement-breakpoint
ALTER TABLE "chat_prefs" ADD COLUMN "background_dim" integer;--> statement-breakpoint
ALTER TABLE "chat_background_defaults" ADD CONSTRAINT "chat_background_defaults_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_background_defaults" ADD CONSTRAINT "chat_background_defaults_background_image_id_chat_backgrounds_id_fk" FOREIGN KEY ("background_image_id") REFERENCES "public"."chat_backgrounds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_backgrounds" ADD CONSTRAINT "chat_backgrounds_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_backgrounds_user_idx" ON "chat_backgrounds" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "chat_prefs" ADD CONSTRAINT "chat_prefs_background_image_id_chat_backgrounds_id_fk" FOREIGN KEY ("background_image_id") REFERENCES "public"."chat_backgrounds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_prefs" ADD CONSTRAINT "chat_prefs_background_preset_check" CHECK ("chat_prefs"."background_preset" IS NULL OR "chat_prefs"."background_preset" IN ('slate', 'gold', 'blue', 'navy', 'forest', 'wine', 'amber'));--> statement-breakpoint
ALTER TABLE "chat_prefs" ADD CONSTRAINT "chat_prefs_background_dim_check" CHECK ("chat_prefs"."background_dim" IS NULL OR "chat_prefs"."background_dim" BETWEEN 0 AND 80);--> statement-breakpoint
ALTER TABLE "chat_prefs" ADD CONSTRAINT "chat_prefs_background_exclusive_check" CHECK (NOT ("chat_prefs"."background_preset" IS NOT NULL AND "chat_prefs"."background_image_id" IS NOT NULL));