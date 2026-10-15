# Manual production SQL log

**Every SQL statement run by hand on production gets a row here**, with the date
it ran and what it did. Migrations cover our own schema (`apps/server/drizzle/`),
but they cannot touch ejabberd's own tables, the cluster roles and grants, or a
one-off repair. Those runs are recorded in this file, in the same change that
documents them.

Nothing here carries secrets: no passwords, no connection strings, no tokens.
Use placeholders for anything sensitive.

## 2026-10-11 — recreate `push_session`

Production's `push_session` had a different shape from the one the running
ejabberd 26.07 build writes, at the same `schema_version` (`mod_push_sql = 1`),
so XEP-0357 push failed with `internal-server-error` while `/health` stayed
green. `update_sql_schema` cannot repair this (the version does not change), so
the table was dropped and rebuilt. Context:
`work/T-1146-ejabberd-push-enable-audit.md`,
`docs/audit/ejabberd-push-enable.md`.

Run against the **ejabberd** database:

```sql
DROP TABLE IF EXISTS push_session;
DELETE FROM schema_version WHERE module = 'mod_push_sql';
```

Then the ejabberd container was restarted, so `update_sql_schema` ran
`get_current_version` → `0` → `create_tables` and recreated `push_session` with
the expected columns and indexes.

Effect: every web user had to click "Enable on this device" again in
Notifications; Android re-enabled on the next signed-in session.

## 2026-10-12 — restrict `zilar_archive` to `archive` (SEC-4)

The read-only search role `zilar_archive` could read more than the `archive`
table (the default privilege the old init script stored). Context:
`work/T-1156-deploy-hardening.md`.
Run in the Coolify terminal against the **ejabberd** database as the `postgres`
superuser:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE ejabberd IN SCHEMA public REVOKE SELECT ON TABLES FROM zilar_archive;
REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM zilar_archive;
GRANT SELECT ON public.archive TO zilar_archive;
```

This removes future-table and already-granted access, then restores exactly the
one grant search needs. Re-running it is harmless.

## 2026-10-15 — reset the instance owner (SEC-12)

The instance owner is stored once in `instance_settings` under the key
`instance.owner_user_id`, and the value never changes on its own. To hand
ownership to another account, an operator updates that one row by hand:

```sql
UPDATE instance_settings SET value = '<user id>', updated_at = now()
WHERE key = 'instance.owner_user_id';
```

The procedure and the value's meaning are documented in
[`log-access.md`](./log-access.md#resetting-the-instance-owner-sec-12) (T-1450).
