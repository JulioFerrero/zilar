CREATE TABLE "voice_transcripts" (
	"url_hash" text PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"language" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
