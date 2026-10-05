CREATE TABLE "group_ais" (
	"group_id" text NOT NULL,
	"ai_id" text NOT NULL,
	"added_by" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_ais_group_id_ai_id_pk" PRIMARY KEY("group_id","ai_id")
);
--> statement-breakpoint
ALTER TABLE "group_ais" ADD CONSTRAINT "group_ais_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_ais" ADD CONSTRAINT "group_ais_ai_id_ais_id_fk" FOREIGN KEY ("ai_id") REFERENCES "public"."ais"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_ais" ADD CONSTRAINT "group_ais_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;