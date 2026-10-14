SET lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "ais" ADD COLUMN "computer_mode" text NOT NULL DEFAULT 'off';--> statement-breakpoint
ALTER TABLE "ais" ADD CONSTRAINT "ais_computer_mode_check" CHECK ("computer_mode" IN ('off','cloud','runner','auto'));
