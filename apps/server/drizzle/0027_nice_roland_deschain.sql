CREATE TABLE "group_member_roles" (
	"role_id" text NOT NULL,
	"user_id" text NOT NULL,
	"assigned_by" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_member_roles_role_id_user_id_pk" PRIMARY KEY("role_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "group_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_role_access" (
	"topic_id" text NOT NULL,
	"role_id" text NOT NULL,
	CONSTRAINT "topic_role_access_topic_id_role_id_pk" PRIMARY KEY("topic_id","role_id")
);
--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "approver_role_id" text;--> statement-breakpoint
ALTER TABLE "group_member_roles" ADD CONSTRAINT "group_member_roles_role_id_group_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."group_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_member_roles" ADD CONSTRAINT "group_member_roles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_member_roles" ADD CONSTRAINT "group_member_roles_assigned_by_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_roles" ADD CONSTRAINT "group_roles_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_roles" ADD CONSTRAINT "group_roles_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_role_access" ADD CONSTRAINT "topic_role_access_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_role_access" ADD CONSTRAINT "topic_role_access_role_id_group_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."group_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_roles_group_idx" ON "group_roles" USING btree ("group_id");--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_approver_role_id_group_roles_id_fk" FOREIGN KEY ("approver_role_id") REFERENCES "public"."group_roles"("id") ON DELETE set null ON UPDATE no action;