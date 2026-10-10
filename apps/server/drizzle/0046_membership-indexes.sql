CREATE INDEX IF NOT EXISTS "group_members_user_id_idx" ON "group_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topic_members_user_id_idx" ON "topic_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topic_ais_ai_id_idx" ON "topic_ais" USING btree ("ai_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_ais_ai_id_idx" ON "group_ais" USING btree ("ai_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_member_roles_user_id_idx" ON "group_member_roles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "xmpp_accounts_lower_jid_idx" ON "xmpp_accounts" USING btree (lower("jid"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_contact_user_id_idx" ON "contacts" USING btree ("contact_user_id");
