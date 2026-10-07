ALTER TABLE "groups" ADD COLUMN "background_preset" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "background_image_id" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "background_dim" integer;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_background_image_id_chat_backgrounds_id_fk" FOREIGN KEY ("background_image_id") REFERENCES "public"."chat_backgrounds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_background_preset_check" CHECK ("groups"."background_preset" IS NULL OR "groups"."background_preset" IN ('slate', 'gold', 'blue', 'navy', 'forest', 'wine', 'amber'));--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_background_dim_check" CHECK ("groups"."background_dim" IS NULL OR "groups"."background_dim" BETWEEN 0 AND 80);--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_background_exclusive_check" CHECK (NOT ("groups"."background_preset" IS NOT NULL AND "groups"."background_image_id" IS NOT NULL));