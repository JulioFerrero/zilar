ALTER TABLE "groups" ADD COLUMN "visibility" text DEFAULT 'private' NOT NULL;
--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_visibility_check" CHECK ("groups"."visibility" IN ('private', 'public'));
