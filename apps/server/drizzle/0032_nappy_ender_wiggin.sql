CREATE TABLE "sticker_favorites" (
	"user_id" text NOT NULL,
	"sticker_id" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sticker_favorites_user_id_sticker_id_pk" PRIMARY KEY("user_id","sticker_id")
);
--> statement-breakpoint
ALTER TABLE "sticker_favorites" ADD CONSTRAINT "sticker_favorites_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sticker_favorites" ADD CONSTRAINT "sticker_favorites_sticker_id_stickers_id_fk" FOREIGN KEY ("sticker_id") REFERENCES "public"."stickers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sticker_favorites_user_idx" ON "sticker_favorites" USING btree ("user_id");