# Audit: XEP-0357 `<enable/>` fails with `internal-server-error` in production (T-1146)

Docs only. No code, config or schema change in this task. Line numbers are from
the branch `task/T-1146-ejabberd-push-enable-audit` on 2026-10-11. Sources are
`path:line` in this repo and the ejabberd 26.07 sources (GitHub tag `26.07`,
the tag the pinned image is built from). Anything I could not observe on
production is marked **unverified**.

## Summary

- The client sends `<enable jid="push.<domain>" node="…"/>` over the user's own
  session (`apps/web/src/lib/push/usePushEnable.ts:192`,
  `packages/xmpp-core/src/stanza/build-outgoing.ts:255-265`).
- `internal-server-error` is the **only** error ejabberd's `mod_push` returns
  when its SQL write to the `push_session` table fails (`{error, db_failure}`).
  A missing session is `item-not-found`; an absent/empty node is
  `feature-not-implemented`. So the production failure is a **SQL failure**, not
  a refused JID and not a missing session.
- **The local stack does not reproduce it.** A real `<enable/>` from a real
  session answers `result`, and `mod_push` logs "Enabling push notifications
  for …". See §3.
- Local and production run the **same ejabberd image digest**
  (`sha256:5aeb0faa…`, verified against the registry, §5) and the same push
  config, so the difference is the persisted **`push_session` table**. When that
  table's shape does not match the schema the running build expects, every
  `<enable/>` fails exactly this way.
- ejabberd cannot self-heal it: `mod_push_sql`'s schema **version is 1 in both
  the old and the new table shape**, so `update_sql_schema` treats the table as
  current and never migrates it (§4.3).
- **Fix:** reset the table and its `schema_version` row and restart ejabberd; the
  running build recreates the table in its own shape (§7). Verify per §8.

## 1. What the client sends

`setPushEnabled` builds an IQ `set` with a single `<enable/>` child carrying
only `jid`, `node` and the XEP-0357 namespace — no `<publish-options>`
(`packages/xmpp-core/src/stanza/build-outgoing.ts:255-265`). `pushJid` and
`node` come from `POST /api/push/subscriptions`; on production `pushJid` is
`push.chat.zilar.app`. Web and Android use the same step
(`apps/web/src/lib/push/usePushEnable.ts:189-202`,
`apps/mobile/src/lib/push/native.ts:109`).

## 2. What `internal-server-error` means here

From `mod_push.erl` (26.07), the enable IQ handler:

```erlang
process_iq(#iq{from = #jid{lserver = LServer} = JID,
               to = #jid{lserver = LServer},
               lang = Lang,
               sub_els = [#push_enable{jid = PushJID, node = Node, xdata = XData}]} = IQ) ->
    case enable(JID, PushJID, Node, XData) of
        ok -> xmpp:make_iq_result(IQ);
        {error, db_failure} ->
            Txt = ?T("Database failure"),
            xmpp:make_error(IQ, xmpp:err_internal_server_error(Txt, Lang));
        {error, notfound} ->
            Txt = ?T("User session not found"),
            xmpp:make_error(IQ, xmpp:err_item_not_found(Txt, Lang))
    end;
```

`enable/4` returns `{error, db_failure}` only when `store_session/6` fails, and
`mod_push_sql:store_session/6` returns `{error, db_failure}` whenever its
`INSERT … ON CONFLICT` into `push_session` does not return `ok`.

Conclusion: production's `<enable/>` reaches a loaded `mod_push` (otherwise the
IQ would be `service-unavailable`, not `internal-server-error`) and then the
**SQL write into `push_session` fails**.

## 3. Reproduction attempt on the local stack

Stack: `zilar-dev` already up (`postgres`, `ejabberd` 26.7.0, `litellm`);
ejabberd image `ghcr.io/processone/ejabberd:26.07`, started 2026-10-06.

Method: a throwaway script (in the devtools package, deleted before this commit)
that registers a test user through the admin API, mints a JWT with the repo's own
`issueXmppToken`, connects over the real `/ws` session (`@xmpp/client`, the same
code as `packages/devtools/src/xmpp-e2e/`) and sends the exact IQ from §1:

```xml
<iq type="set" id="enable-…"><enable xmlns="urn:xmpp:push:0"
    jid="push.zilar.localhost" node="repro-…"/></iq>
```

Result:

```
enable answer from ejabberd: result
```

`docker logs zilar-dev-ejabberd-1` around the IQ:

```
2026-10-11 18:45:26.665 [info] (websocket|<0.8106.0>) Accepted c2s PLAIN authentication for <test-user>@zilar.localhost by jwt backend from 172.21.0.1
2026-10-11 18:45:26.669 [info] (websocket|<0.8106.0>) Opened c2s session for <test-user>@zilar.localhost/push-repro
2026-10-11 18:45:26.839 [info] Enabling push notifications for <test-user>@zilar.localhost/push-repro
2026-10-11 18:45:27.048 [info] (websocket|<0.8106.0>) Closing c2s session for <test-user>@zilar.localhost/push-repro: Stream reset by peer
```

The row was really written (`select count(*) from push_session` → `1`). **So the
local stack does not reproduce the production failure.**

## 4. The `push_session` table

### 4.1 Local shape

```
                    Table "public.push_session"
  Column   |  Type  | Nullable |
-----------+--------+----------+
 username  | text   | not null |
 timestamp | bigint | not null |
 service   | text   | not null |
 node      | text   | not null |
 xml       | text   | not null |
Indexes:
    "push_session_pkey" PRIMARY KEY, btree (username, "timestamp")
    "i_push_session_username_service_node" UNIQUE, btree (username, service, node)
```

`schema_version`: `mod_push_sql = 1`.

### 4.2 ejabberd 26.07 expects one of two shapes, chosen at compile time

`mod_push_sql:sql_schemas/0` (26.07) declares the table **with a `server_host`
column** and the indexes `(server_host, username, timestamp)` /
`(server_host, username, service, node)`. But the generated queries contain
**both** the single-host and the multi-host variants, and `ejabberd_sql_schema`
strips `server_host` when the compile-time option `sql_schema_multihost` is
false (`filter_table_sh/2`). That option's default comes from the build flag
`--enable-sql-schema-multihost` (`ejabberd_options.erl`:
`-ifdef(MULTIHOST_SQL_SCHEMA)`).

The running container is the **single-host** build. Evidence:

```
$ docker exec zilar-dev-ejabberd-1 sh -c \
  'strings /opt/ejabberd-26.07/lib/ejabberd-26.7.0/ebin/mod_push_sql.beam' \
  | grep -E 'INSERT INTO|ON CONFLICT'
JINSERT INTO push_session(username, timestamp, service, node, xml) VALUES (
WINSERT INTO push_session(username, server_host, timestamp, service, node, xml) VALUES (
@) ON CONFLICT (username, service, node) DO UPDATE SET timestamp=
M) ON CONFLICT (username, server_host, service, node) DO UPDATE SET timestamp=
```

Locally the **single-host** pair is used: the row from §3 landed in a table with
no `server_host` column, and the multi-host form fails against that table:

```
$ docker exec zilar-dev-postgres-1 psql -U postgres -d ejabberd -c \
  "select timestamp, xml from push_session where username='u' and \
   server_host='zilar.localhost' and service='s' and node='n';"
ERROR:  column "server_host" does not exist
```

The mirror test, on a table **with** `server_host` (scratch schema, dropped
immediately after), succeeds: the multi-host `INSERT … ON CONFLICT` wrote one
row. So the failure is purely a shape mismatch.

### 4.3 Why `update_sql_schema` never fixes it

`ejabberd_sql_schema:update_schema/3` reads the stored version and only migrates
when it is **lower** than the module's current schema version:

```erlang
Version = get_current_version(Host, Module, Schemas),
LastVersion = LastSchema#sql_schema.version,
case Version of
    ... 0 -> create_tables(...);
    LastVersion -> ok;                      %% <-- stored == current: no-op
    _ when LastVersion < Version -> error;
    _ -> lists:foldl(... do_update_schema ...)
end.
```

`mod_push_sql` declares **version 1 in both the single-host and the multi-host
shape**, so a table created by one shape and later run by the other is left
untouched: `schema_version.mod_push_sql` is already `1`. There is no migration
path for this table.

## 5. Local vs production differences, ranked

Both stacks use the same images and the same push config:

| Thing | Local (`infra/`) | Production (`deploy/`) |
| --- | --- | --- |
| ejabberd image | `ghcr.io/processone/ejabberd:26.07`, digest `sha256:5aeb0faa…` | same tag |
| Postgres image | `pgvector/pgvector:0.8.6-pg18-trixie` | same |
| `mod_push` block | `include_sender/body: false` (+`mod_push_keepalive`) | identical |
| `update_sql_schema` | `true` | `true` |
| hosts / component | `zilar.localhost` / `push.zilar.localhost` | `chat.zilar.app` / `push.chat.zilar.app` |

The registry digest for the tag is identical to the local image
(`docker buildx imagetools inspect ghcr.io/processone/ejabberd:26.07` →
`sha256:5aeb0faa39cfe38792c5eea9cc6344ba9ab6c59c708a24e897d6b471882c8497`), so the
build is the same **unless the production host reused an older cached pull**
(unverified). The config differences (TLS/`certfiles`, the `internal` ACL vs
`loopback`, the upload quota lines, `mod_ping` options) do not touch `mod_push`.

That leaves the persisted `push_session` table as the only difference that can
produce `{error, db_failure}`. Ranked:

1. **The table exists in the multi-host shape** (it has `server_host` `NOT NULL`)
   while the pinned build is single-host. The single-host `INSERT` omits
   `server_host` → not-null violation, or the `ON CONFLICT (username, service,
   node)` finds no matching unique index → `db_failure`. Most likely.
2. **The table exists but something else does not match** (e.g. only the old
   single-host indexes and a `server_host` column, or a renamed/extra column).
3. **The table is missing** while `schema_version.mod_push_sql` is `1`; then both
   the `SELECT` and the `INSERT` fail. Less likely, because `mod_push` clearly
   loaded (§2).

What could have created a multi-host table on production but not locally: an
earlier deploy of a different ejabberd build (a bare-metal install, a distro
package or an older image whose default was `sql_schema_multihost: true`), whose
table the current single-host image inherited. **This part is inferred**; the
production table itself could not be read (see below).

Production observability limit (same as the lead found): the Coolify app exposes
only the **web/Caddy** container logs. Asking for the `ejabberd` container
(`logs` with `container=ejabberd`) returns the Caddy logs again, and the
deployment logs are truncated summaries. The `ejabberd` and `postgres` container
logs are not reachable through the Coolify MCP.

## 6. Cause

`mod_push`'s `<enable/>` handler answers `internal-server-error` when its SQL
write into the `push_session` table fails. Production's `push_session` table is
not in the shape the running (single-host) ejabberd build writes, and
`update_sql_schema` cannot repair it because the table's schema version (1) was
never bumped when the shape changed. Local works because its table is the
correct single-host shape. Confidence: **high** on the mechanism and on the
local non-reproduction; **medium** on which of the three table states above
production is in, since the production database could not be inspected.

## 7. Smallest fix

No repo change is required to repair an existing install. Reset the table and let
the running build recreate it in its own shape (direction-agnostic, so it also
fixes the missing-table case). Push registrations can be recreated, but only the
mobile app does so on its own: it registers the FCM token once per signed-in
session and retries a failed enable on the next launch
(`apps/mobile/src/store/chat-store-provider.tsx:142-157`,
`apps/mobile/src/lib/push/native.ts:94-99`). Web has no session-start hook — the
only entry point is the manual "Enable on this device" button in Notifications
(`apps/web/src/routes/NotificationsPage.tsx:121`). So dropping the table is safe,
but **after the restart every web user must revisit Notifications and click
Enable again**; otherwise their web devices stay silent until they do.

Run in the **ejabberd** database (as `postgres` or the `ejabberd` role):

```sql
DROP TABLE IF EXISTS push_session;
DELETE FROM schema_version WHERE module = 'mod_push_sql';
```

Then restart the ejabberd container (`docker restart <ejabberd container>`), so
`update_sql_schema` runs `get_current_version` → `0` → `create_tables`, and
recreates `push_session` with the columns and indexes the build expects. Confirm
with §8.

Follow-up hardening for a later task (not done here):

- `deploy/ejabberd/Dockerfile:19` — pin the base image by digest
  (`FROM ghcr.io/processone/ejabberd:26.07@sha256:5aeb0faa…`), so a silent
  base-image change (or a stale build cache on the host) cannot change the SQL
  schema the server expects under a fixed tag.
- Add a `doctor` / deploy check that verifies `push_session` has the columns and
  the `(username, service, node)` unique index the running build uses, and that
  XEP-0357 discovery is advertised, so this class of mismatch fails loudly at
  deploy instead of silently breaking push.

## 8. How to verify on production

1. **Before the fix**, confirm the shape (read-only):

   ```sql
   SELECT column_name FROM information_schema.columns
    WHERE table_name = 'push_session' ORDER BY ordinal_position;
   SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'push_session';
   SELECT version FROM schema_version WHERE module = 'mod_push_sql';
   ```

   A `server_host` column, or a missing
   `i_push_session_username_service_node` index, confirms the mismatch.

2. Apply §7, restart ejabberd, then enable push on a real client (Android or
   web). Expect a `result` IQ (no `internal-server-error`), and in the ejabberd
   log the line `Enabling push notifications for <user>@chat.zilar.app/…`.
   Android re-enables by itself on the next signed-in session; on web each user
   must open Notifications and click Enable again (§7).

3. `SELECT count(*) FROM push_session;` → 1 for that session.

4. Send a real DM from another account with the app backgrounded; the device
   must now notify (previously only the server-side `push.test` path worked).
   Then `SELECT * FROM push_session;` to confirm the row survives.

## 9. Correction (T-1150)

The theory above — that production's `push_session` table was in the wrong shape
— was wrong. The production table had the right columns. The real production log
line is:

```
SQL query at {mod_push_sql,{77,9}} failed: duplicate key value violates unique constraint "push_session_pkey"
  Key (username, "timestamp")=(pzooiu…, 1791746892000145) already exists.
```

`push_session`'s primary key is `(username, timestamp)`, and the timestamp is the
c2s session's own timestamp, so **one c2s session can hold one push enable**: a
second `<enable/>` with a different node on the same session answers
`internal-server-error`, while the same node twice is the `ON CONFLICT (username,
service, node)` update and works. The Android app registered the same FCM token
twice per launch, the server minted a fresh node for each token key, and the
second enable failed on the session-timestamp key, leaving nothing enabled.

T-1150 (`work/T-1150-push-register-idempotent.md`) fixes it in code: the server
keeps a device row's `id` and `node` when the same token (or Web Push endpoint)
is re-registered, and the app registers a token once per session.
