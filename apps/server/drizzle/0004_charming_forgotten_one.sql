CREATE TABLE "provider_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"provider" text NOT NULL,
	"encrypted_key" text NOT NULL,
	"label" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_owner_user_id_fk" FOREIGN KEY ("owner") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_connections_owner_idx" ON "provider_connections" USING btree ("owner");