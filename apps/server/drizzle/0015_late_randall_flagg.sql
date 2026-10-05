ALTER TABLE "ais" ADD COLUMN "machine_id" text;--> statement-breakpoint
ALTER TABLE "ais" ADD CONSTRAINT "ais_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ais_machine_idx" ON "ais" USING btree ("machine_id");