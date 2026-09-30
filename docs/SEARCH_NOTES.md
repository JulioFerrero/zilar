# Search notes (T-0117 discovery)

Verified from `\d archive`, the ejabberd `pg.sql` schema, and the
`mod_mam.erl` / `mod_mam_sql.erl` (26.07) sources. No message contents
were read: only counts and the table definition were queried.

## Table shape (public.archive)

- `username` — archive owner. A DM is archived once per side (each
  participant's own row); a room message once with `username` = the
  room's bare JID (`store/10` with `Type = groupchat`).
- `timestamp bigint` — microseconds since epoch, also the MAM stanza id.
- `peer` — full JID of the other side; `bare_peer` — without resource.
- `xml` — the full archived stanza. `txt` — the `<body/>` cdata only
  (nullable; body-less stanzas archive with NULL/empty `txt`).
- `id bigserial` — insert sequence, not the message id. Ignore it.
- `kind` — `'chat'` (DM) or `'groupchat'` (room). `nick` — the MUC
  occupant nick for rooms, empty for DMs.
- `origin_id` — the sender-generated id (`<origin-id/>` in DMs per
  XEP-0359, the stanza-id string in rooms). Clients address edits,
  retractions and reactions by this value.
- `created_at` — insert time, not send time. Ignore it.

Indexes (live `\d`): `(timestamp)`, `(username, bare_peer)`,
`(username, origin_id)`, `(username, peer)`, `(username, timestamp)`.

## Corrections and retractions (derived, not read)

- A correction (XEP-0308) archives as a second row with the new full
  body plus `<replace/>` naming the original `origin_id`; the old row
  stays. A retraction (XEP-0424) archives as a row whose body is the
  fixed fallback sentence plus `<retract/>` naming the target.
- Room rows follow the same pattern (`username` = room JID).

## Design consequences

- Show the latest text per `(chat, origin_id)` target only (newest
  `timestamp` wins); exclude anything retracted and never match a
  retract row itself. Both are detected from `xml`, never `txt`.
- Query only rows the caller owns: `username` = caller localpart with
  a `bare_peer` filter for DMs, or a visible room JID for groups and
  topics. The allowed set comes from our tables, never client input.
- No expression index is possible in the ejabberd database, so every
  query runs as a sequential scan capped to the last 12 months and 5 000
  candidate rows; the `WHERE username … AND timestamp > …` prefix keeps
  the scan on the existing `(username, timestamp)` index. Very large
  archives may still be slow, but the 3 s statement timeout protects the
  database from any single search.
- `messageId` is `origin_id`; `at` is `timestamp` as ISO; the chat JID
  is reconstructed per owner row, not taken from client input.
