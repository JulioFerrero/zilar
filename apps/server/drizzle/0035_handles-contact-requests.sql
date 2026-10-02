CREATE TABLE "contact_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"from_user_id" text NOT NULL,
	"to_user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "contact_requests_status_check" CHECK ("contact_requests"."status" IN ('pending', 'accepted', 'declined', 'cancelled')),
	CONSTRAINT "contact_requests_different_users_check" CHECK ("contact_requests"."from_user_id" <> "contact_requests"."to_user_id")
);
--> statement-breakpoint
CREATE TABLE "handles" (
	"handle_lower" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"user_id" text,
	"group_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "handles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "handles_group_id_unique" UNIQUE("group_id"),
	CONSTRAINT "handles_owner_check" CHECK (num_nonnulls("handles"."user_id", "handles"."group_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "retired_handles" (
	"handle_lower" text PRIMARY KEY NOT NULL,
	"former_user_id" text,
	"former_group_id" text,
	"reserved_until" timestamp with time zone NOT NULL,
	CONSTRAINT "retired_handles_owner_check" CHECK (num_nonnulls("retired_handles"."former_user_id", "retired_handles"."former_group_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "contact_requests" ADD CONSTRAINT "contact_requests_from_user_id_user_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_requests" ADD CONSTRAINT "contact_requests_to_user_id_user_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handles" ADD CONSTRAINT "handles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handles" ADD CONSTRAINT "handles_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retired_handles" ADD CONSTRAINT "retired_handles_former_user_id_user_id_fk" FOREIGN KEY ("former_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retired_handles" ADD CONSTRAINT "retired_handles_former_group_id_groups_id_fk" FOREIGN KEY ("former_group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_requests_pending_idx" ON "contact_requests" USING btree ("from_user_id","to_user_id") WHERE "contact_requests"."status" = 'pending';