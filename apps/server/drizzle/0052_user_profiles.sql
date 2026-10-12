CREATE TABLE "user_profiles" ("user_id" text PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE, "bio" text NOT NULL DEFAULT '', "updated_at" timestamp with time zone NOT NULL DEFAULT now());
