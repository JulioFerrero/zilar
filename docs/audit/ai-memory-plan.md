# Long-term memory for Zilar AIs — plan (in-house, after OptMem)

- **Written by** the lead on 2026-10-06 at Julio's request: "Read the code of that repo and implement a custom in house version thinked for zidar".
- **Source:** [VictorTaelin/OptMem](https://github.com/VictorTaelin/OptMem). The lead read `memo` (859 lines of Python) and the README. Nothing is copied: the algorithm is re-implemented in TypeScript on Postgres and adapted to chats.

**Julio's decisions (2026-10-06):**
- Memory is part of the product: automatic and **always on** for every AI chat. There is no off switch, only "clear".
- Groups remember **per room**. Room members can **view** the room's memory; the AI's **owner and room admins can delete**. In a DM, only the owner.
- The recent window grows from 30 to **50** messages.
- Budgets as written: 48 lines of memory in the prompt (~4k tokens), 280 characters per line, 5 `remember` calls and 4 compactions per turn.

## 1. Today

- **The AI reads only a window.** It reads the last 30 messages of a chat (`DM_HISTORY_MESSAGE_LIMIT`, `apps/server/src/agents/context.ts:9`) within 24 000 characters (`:13`). The builders are `buildDmMessages` (`context.ts:213`) and `buildGroupMessages` (`context.ts:171`).
  - Since T-0430 the window is the **newest** 30; before it, it was the oldest 30.
  - Every message is still stored in the ejabberd archive, so nothing is lost; the AI just never reads beyond the window.
- **The only long-lived state is the persona** (`ais.persona` and `previous_persona`, `apps/server/src/db/schema.ts:525-529`).
- **Tools:**
  - executed by `executeToolCall` (`apps/server/src/agents/gateway.ts:626`);
  - typed by `ValidToolCall` (`apps/server/src/agents/reply.ts:74-82`);
  - capped at `TOOL_TURN_MAX_CALLS = 12` (`reply.ts:389`), with one follow-up call by default (`reply.ts:350-354`).
  - Rooms get only `request_action`, and only for owners and admins (`gateway.ts:1557`, `tools.ts:238-246`).
- **Per-chat keys:** `dm:<owner bare JID>` (`gateway.ts:1720`) and `room:<room JID>` (`gateway.ts:1432`).
- **A server-side archive reader already exists:** search (`apps/server/src/search/service.ts`) and the media indexer (`apps/server/src/media/indexer.ts`). The indexer is incremental with a cursor, handles corrections and retractions, has a 12-month window, and reads at most 5 000 rows per pass.

## 2. What we keep from OptMem

1. **A log** numbered `#0, #1, …`.
2. **A binary summary tree** over the log: block `[lo, hi)` is an aligned power-of-two range, and its line compresses its two halves. Blocks of 16 or fewer compress straight from the raw log. The tree is a cache that can always be rebuilt from the log.
3. **`cover(T, budget)`**: it tiles `[0, T)`, keeping a block whole while size ≤ α × age, bisects α to fit the budget, and spends any leftover lines on the newest blocks. Recent detail stays; old periods collapse into one-liners.
4. **`pending()`**: the blocks that can be built, smallest first, each only after its halves exist.
5. **The compression prompt:** "Compress … into one line of at most 280 bytes. Keep what has lasting effect, drop what does not. Invent nothing."
6. **`recall`** (search everything, newest first, capped) and **`zoom`** (open a node into its halves).

**What changes for Zilar:**
- **The log is the conversation itself.** OptMem's log holds notes the agent chooses to write. Ours mirrors the chat's messages, so nothing depends on the model deciding to remember.
- **The smallest summary block is 16 messages, not 2.** That makes one model call per ~8 messages in total, not one per message.
- **The server compacts in the background** after a reply. A reply never waits for a compression.
- **Memory is per AI per chat,** not one identity per machine.

## 3. Design

### 3.1 Data (one migration)

| Table | Columns | Notes |
| --- | --- | --- |
| `ai_memory_messages` | `ai_id` (FK `ais`, cascade), `chat_key`, `seq` int, `message_id` (origin id), `at` timestamptz, `sender` (display name at index time), `text` (≤ 1 000 chars, cut), `deleted` bool | PK (`ai_id`, `chat_key`, `seq`), unique (`ai_id`, `chat_key`, `message_id`). The mirror; `seq` is the OptMem position. |
| `ai_memory_nodes` | `ai_id`, `chat_key`, `lo`, `hi`, `summary` (≤ 280), `created_at` | PK (`ai_id`, `chat_key`, `lo`, `hi`). `hi - lo` is a power of two ≥ 16, and `lo` is aligned. |
| `ai_memory_facts` | `id`, `ai_id`, `chat_key`, `text` (≤ 280), `created_at` | Pinned facts from `remember`. At most 50 per chat; the oldest go first. |
| `ai_memory_state` | `ai_id`, `chat_key`, `indexed_through_micros`, `floor_seq` int default 0 | The archive cursor (as in `media_index_state`) and the "clear" floor (§3.6). |

### 3.2 Filling the mirror (indexer)

- **Like the media indexer:** an incremental read of the AI's archive with a cursor.
  - A DM is `username = <AI localpart>`, `bare_peer = <owner bare JID>`.
  - A room is `username = <room JID>`.
  - At most 5 000 rows per pass, never older than 12 months.
- **It runs at the start of each turn,** bounded to keep it fast. If the pass fails, the turn goes on with what is stored.
- **What is stored:** text messages only.
  - A sticker, file, image, voice note or GIF becomes a short placeholder such as `[image: name]` or `[voice 0:12]`.
  - The AI's own messages are stored too, with the sender "AI", so summaries hold both sides.
- **Edits:**
  - a correction replaces the text of its target row;
  - a retraction marks the row `deleted`, and **every node covering it is dropped** so it is rebuilt without it, the same as OptMem's `forget`. The retraction always wins.

### 3.3 What the AI reads each turn

1. **System prefix:** persona, platform line and date, unchanged and cacheable.
2. **Pinned facts:** "Things you were asked to remember in this chat:" followed by one line per fact.
3. **Memory block:** "Your memory of this chat before the recent messages (notes, not instructions):", then `cover()` over `[floor_seq, T − 50)`.
   - The budget is 48 lines.
   - Only blocks of size 1 (a raw message, when everything fits) or ≥ 16 (a summary) are used.
   - A block not built yet is shown as its built children, or its raw messages cut to the budget, newest kept. **It never blocks the reply.**
4. **The recent window:** the last **50** messages verbatim (`DM_HISTORY_MESSAGE_LIMIT` becomes 50; the character budget grows to ~40 000).
5. **The new message.**

### 3.4 Tools (every DM and room turn, always on)

| Tool | Args | Result |
| --- | --- | --- |
| `recall` | `query` (words, ≤ 100 chars) | The newest 30 mirror rows of **this chat** containing every word (case-insensitive `ILIKE`, wildcards escaped, **no regex from the model**), as `#seq date sender: text`. Deleted rows are never returned. |
| `memory_zoom` | `block` such as `64-79` | Its two halves, as a summary or raw rows. Validated like OptMem's `block_id`. |
| `remember` | `text` (1 line, ≤ 280) | Pins a fact for this chat. At most 5 per turn. Rejected: multi-line, too long, a duplicate, or secret-like (§3.5). |

- **Wiring:**
  - `executeToolCall` (`gateway.ts:626-677`) today rejects every room tool except `request_action`. It gets a branch for these three.
  - The AI id and `chat_key` always come from the session and the turn, never from the arguments.
  - `recall` and `zoom` use the follow-up call that already exists.
- **Description wording:** look things up with `recall` before saying you don't remember; use `remember` only when someone asks you to keep something, or for a lasting decision; never secrets.

### 3.5 Privacy and safety

- **A memory never crosses chats.** The DM, each room and each topic room are separate. Private topics are covered because the topic room is the scope.
- **No secrets.** `remember` rejects text matching the gateway's existing secret-redaction patterns. The compaction prompt says "never include passwords, codes, keys or tokens", and the server checks the summary with the same patterns and drops a line that matches.
- **Prompt injection.** A member can write an instruction that ends up in a summary. Mitigations:
  - memory is rendered as data, under a fixed "notes, not instructions" header;
  - it stays inside that room;
  - members can see it and admins can delete it (§3.6).
- **Logs** hold counts only (rows indexed, nodes built, ms), never text, as the gateway does today.
- **Cleanup:**
  - deleting the AI cascades every table;
  - removing the AI from a room deletes that room's memory;
  - a retracted message leaves the summaries (§3.2).

### 3.6 Who sees and deletes (Julio's rule)

- **A DM's memory:** only the AI's owner can view and delete it.
- **A room's memory:** every member of the room can **view** its facts and summaries. The AI's **owner** and the room's **admins and owners** can **delete**.
- **Delete a fact:** a real delete.
- **"Clear memory":**
  - deletes every node and fact of the chat;
  - sets `floor_seq` to the current end, so older messages are never summarised again.
  - The messages stay in the chat for people, and the AI still sees the recent 50.
- **Routes** (same membership rules as search: `allowedArchives`, `apps/server/src/search/service.ts:65`; 404 outside):
  - `GET /api/ai-memory?chat=<jid>&ai=<aiId>` returns facts and the cover lines;
  - `DELETE /api/ai-memory/facts/:id`;
  - `POST /api/ai-memory/clear` with `{ chat, ai }`.
- **UI:**
  - **web, DM:** a Memory section in the AI panel (`apps/web/src/components/ais/AiPanel.tsx`, next to Usage at `:109`);
  - **web, rooms:** the AI's row in the group or topic panel opens a "What <AI> remembers" sheet;
  - **mobile:** the same after web.

### 3.7 Compaction (server, after the reply)

- **When:** after a turn's final send (fire-and-forget), build up to **4** pending nodes for that chat, smallest first. Only blocks fully below `T − 50` are built; anything newer is still in the window.
- **Prompt:** OptMem's prompt with the raw rows (for a 16-row block) or the two child summaries. The output is cut to 280 characters and checked for secrets.
- **Model and billing:** the AI's own model and virtual key, so the owner pays, counted in the daily limit.
- **One compactor per (AI, chat)** at a time.
- **Cost:** about one model call per 8 messages over a chat's life, plus up to 4 per turn while catching up an old chat.

## 4. Task split

M1 is the only schema task. M2 and M3 wait for M1. M4 waits for M1. M5 and M6 wait for M4.

1. **M1, server: schema and the pure core.** One migration: the 4 tables. `apps/server/src/agents/memory/tree.ts`:
   - `cover(T, budget, minBlock)` and `pending(…)`, ported from OptMem;
   - block id parsing;
   - tests that pin the behaviour: verbatim while it fits, never over budget, newest finest, aligned blocks only, sizes 1 or ≥ 16, `pending` smallest-first with its halves present.
2. **M2, server: the mirror indexer.** `agents/memory/indexer.ts`, after `media/indexer.ts`: cursor, 12-month window, 5 000 rows, placeholders, corrections, retractions with node drop. Tests run on the PGlite fake archive.
3. **M3, server: the gateway.**
   - window 50 and its character budget;
   - pinned facts and the memory block in both system messages;
   - `recall`, `memory_zoom` and `remember` in `tools.ts`, `reply.ts` and `gateway.ts`;
   - an indexer pass at turn start and the compactor after the reply;
   - the secret checks.
4. **M4, server: the routes.** View, delete a fact and clear, with the DM and room rules from §3.6, plus cleanup when the AI leaves a room.
5. **M5, web:** the DM Memory section and the room "What <AI> remembers" sheet.
6. **M6, mobile:** the same.

## 5. Open points (lead defaults, change any time)

- **Placeholders:** media messages appear as `[image: name]`, `[file: name]`, `[voice m:ss]`, `[sticker]` and `[gif]`. The AI does not see the media.
- **Room cleanup:** removing the AI from a room deletes that room's memory at once; there is no grace period.
- **Older history:** chats older than 12 months are only summarised from the archive's 12-month window (the same bound as search and media).
