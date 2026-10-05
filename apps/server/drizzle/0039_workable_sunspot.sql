CREATE TABLE "user_blocks" (
	"user_id" text NOT NULL,
	"blocked_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_blocks_user_id_blocked_user_id_pk" PRIMARY KEY("user_id","blocked_user_id"),
	CONSTRAINT "user_blocks_different_users_check" CHECK ("user_blocks"."user_id" <> "user_blocks"."blocked_user_id")
);
--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_user_id_user_id_fk" FOREIGN KEY ("blocked_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_blocks_blocked_idx" ON "user_blocks" USING btree ("blocked_user_id");