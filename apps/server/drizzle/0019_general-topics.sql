-- T-0108 backfill: one General topic per existing group. The group's
-- existing room becomes its General topic (same room, same history), so
-- `room_localpart` is copied from the group row. The id is deterministic
-- (`md5`, a builtin needing no extension on Postgres or PGlite), and the
-- bare `ON CONFLICT DO NOTHING` makes the statement idempotent, so
-- re-running it after a partial failure is safe.
INSERT INTO "topics" (
  "id", "group_id", "name", "glyph", "room_localpart",
  "visibility", "kind", "status", "is_general", "created_by"
)
SELECT
  md5('topic-general-' || "groups"."id"),
  "groups"."id",
  'General',
  'G',
  "groups"."room_localpart",
  'public',
  'chat',
  'open',
  TRUE,
  "groups"."created_by"
FROM "groups"
ON CONFLICT DO NOTHING;
