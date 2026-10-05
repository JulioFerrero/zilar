CREATE TABLE "topic_ais" (
	"topic_id" text NOT NULL,
	"ai_id" text NOT NULL,
	"added_by" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topic_ais_topic_id_ai_id_pk" PRIMARY KEY("topic_id","ai_id")
);
--> statement-breakpoint
ALTER TABLE "topic_ais" ADD CONSTRAINT "topic_ais_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_ais" ADD CONSTRAINT "topic_ais_ai_id_ais_id_fk" FOREIGN KEY ("ai_id") REFERENCES "public"."ais"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_ais" ADD CONSTRAINT "topic_ais_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;