ALTER TABLE "llm_virtual_keys" ALTER COLUMN "litellm_key_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_virtual_keys" ADD COLUMN "litellm_model_id" text;