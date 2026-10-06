CREATE TABLE "ai_memory_facts" (
	"id" text PRIMARY KEY NOT NULL,
	"ai_id" text NOT NULL,
	"chat_key" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_memory_messages" (
	"ai_id" text NOT NULL,
	"chat_key" text NOT NULL,
	"seq" integer NOT NULL,
	"message_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"sender" text NOT NULL,
	"text" text NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_memory_messages_ai_id_chat_key_seq_pk" PRIMARY KEY("ai_id","chat_key","seq")
);
--> statement-breakpoint
CREATE TABLE "ai_memory_nodes" (
	"ai_id" text NOT NULL,
	"chat_key" text NOT NULL,
	"lo" integer NOT NULL,
	"hi" integer NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_memory_nodes_ai_id_chat_key_lo_hi_pk" PRIMARY KEY("ai_id","chat_key","lo","hi")
);
--> statement-breakpoint
CREATE TABLE "ai_memory_state" (
	"ai_id" text NOT NULL,
	"chat_key" text NOT NULL,
	"indexed_through_micros" bigint DEFAULT 0 NOT NULL,
	"floor_seq" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_memory_state_ai_id_chat_key_pk" PRIMARY KEY("ai_id","chat_key")
);
--> statement-breakpoint
ALTER TABLE "ai_memory_facts" ADD CONSTRAINT "ai_memory_facts_ai_id_ais_id_fk" FOREIGN KEY ("ai_id") REFERENCES "public"."ais"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_memory_messages" ADD CONSTRAINT "ai_memory_messages_ai_id_ais_id_fk" FOREIGN KEY ("ai_id") REFERENCES "public"."ais"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_memory_nodes" ADD CONSTRAINT "ai_memory_nodes_ai_id_ais_id_fk" FOREIGN KEY ("ai_id") REFERENCES "public"."ais"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_memory_state" ADD CONSTRAINT "ai_memory_state_ai_id_ais_id_fk" FOREIGN KEY ("ai_id") REFERENCES "public"."ais"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_memory_facts_chat_created_idx" ON "ai_memory_facts" USING btree ("ai_id","chat_key","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_memory_messages_unique_idx" ON "ai_memory_messages" USING btree ("ai_id","chat_key","message_id");