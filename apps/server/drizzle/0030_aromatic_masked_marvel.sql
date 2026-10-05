ALTER TABLE "groups" ADD COLUMN "kind" text DEFAULT 'group' NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "description" text;