---
id: T-0461
title: "Backgrounds D (web): load the background prefs and default, paint each chat's effective background (preset or image + dim)"
status: merged
milestone: M5
branch: task/T-0461-web-render-backgrounds
model: auto
effort: low
depends_on: [T-0457, T-0458]
estimate: 0.5 day
---

# T-0461: web paints chat backgrounds

## Spec (written by Claude, do not edit)

### Why
This is plan `docs/audit/chat-backgrounds-plan.md` §5 and §8, task D. The server already stores per-chat background prefs and a per-user default (T-0458), and the presets are in `@zilar/ui-tokens` (T-0457).

This task makes the web read them and paint them. The picker is the next task, so nothing writes yet. **With no choice made, every chat must look exactly as today.**

### Verified facts (do not re-derive)
- **Server API (T-0458):**
  - each row of `GET /api/chat-prefs` (`{ prefs }`) now also has `backgroundPreset: string | null`, `backgroundImageId: string | null` and `backgroundDim: number | null`;
  - `GET /api/chat-background` returns `{ defaultBackground: { backgroundPreset, backgroundImageId, backgroundDim } }`, all null when unset;
  - images will be served at `/api/backgrounds/<id>` (T-0460).
- **Web API (`apps/web/src/lib/api.ts`):**
  - `chatPrefSchema` (lines 760-766) has `chatJid`, `mutedUntil`, `archived`, `pinnedAt`, `updatedAt`;
  - `chatPrefsSchema` is at line 770;
  - `listChatPrefs()` is at lines 778-780;
  - `request(path, schema)` is at line 191, and mock mode answers it through `mockRequest` (lines 194-195).
- **Mock API (`apps/web/src/mock/api.ts:2468-2475`):** handles `GET` and `PUT /chat-prefs`.
- **Store:**
  - `apps/web/src/store/store.ts:248-250` declares `chatPrefs: Record<string, ChatPref>` (keyed by lowercased chat JID) and `refreshChatPrefs`;
  - the mock store implementation is at lines 1034-1050;
  - in `apps/web/src/store/realStore.ts`, `boot(gen)` is at line 3051. It loads prefs in a `Promise.all` (around line 3057) and sets `chatPrefs: byJid` at line 3090.
- **Paint (`apps/web/src/index.css`):** `--chat-background` is at line 133, and `.chat-background { background: var(--chat-background); }` at lines 585-586. `apps/web/src/components/MessageList.tsx` uses the class on three elements (lines 201, 213 and 226), with `chat.id`.
- **Prefs lookup:** `applyChatPrefs` (`apps/web/src/lib/chatPrefs.ts:53-75`) looks prefs up by `chat.id.toLowerCase()`.
- **Presets:** `chatBackgroundPresets`, `CHAT_BACKGROUND_PRESET_IDS`, `DEFAULT_CHAT_BACKGROUND_PRESET` and `chatGrid` are in `@zilar/ui-tokens`, which `apps/web/package.json` already depends on.

### What to build
1. **`lib/api.ts`:**
   - add the three background fields to `chatPrefSchema` as `.nullable().optional()`, so old rows still parse;
   - export `type ChatBackgroundChoice = { backgroundPreset: string | null; backgroundImageId: string | null; backgroundDim: number | null }`;
   - add `getChatBackgroundDefault(): Promise<ChatBackgroundChoice>`, calling `GET /chat-background`.
2. **`mock/api.ts`:** `GET /chat-background` returns all nulls.
3. **New `lib/chatBackground.ts`:**
   - **`effectiveBackground(pref, fallback)`:** a pref with a preset or an image wins. Otherwise use the fallback (the default) if it has a preset or an image. Otherwise use `{ kind: 'preset', id: 'slate' }`.
     - It returns `{ kind: 'preset'; id } | { kind: 'image'; imageId; dim }`.
     - The dim defaults to 40.
     - An unknown preset id falls back to `slate`.
   - **`chatBackgroundStyle(effective): React.CSSProperties`:**
     - for `slate`, return `{}`, so the CSS variable keeps today's exact look;
     - for another preset, return `background: radial-gradient(<dot> 1px, transparent 1px) 0 0 / 22px 22px <ground>`;
     - for an image, return `background: linear-gradient(rgba(0,0,0,<dim/100>), rgba(0,0,0,<dim/100>)), url("/api/backgrounds/<encodeURIComponent(id)>") center / cover no-repeat <panel>`, with `<panel>` taken from `chatGrid.background`.
4. **Store:**
   - add `defaultBackground: ChatBackgroundChoice | null` (initially null) and `refreshDefaultBackground(): Promise<void>` to `store.ts`, the mock store and `realStore.ts`;
   - in `realStore` `boot`, call it without blocking the chat list. A failure leaves `null`;
   - `stop()` and sign-out reset it to null where `chatPrefs` resets to `{}`.
5. **`MessageList.tsx`:** compute `chatBackgroundStyle(effectiveBackground(store.chatPrefs[chat.id.toLowerCase()], store.defaultBackground))` once, and pass it as `style` on all three `chat-background` elements.
6. **Tests:**
   - **New `lib/chatBackground.test.ts`:**
     - the precedence: the pref preset wins over the default, the pref image wins, the default is used when the pref is empty, and slate when both are empty;
     - an unknown id falls back to slate;
     - slate gives `{}`;
     - `navy` gives a string containing `#1d3357` and `#0b1322`;
     - an image with dim 55 gives `rgba(0,0,0,0.55)` and `/api/backgrounds/abc`;
     - an image with no dim gives 0.4.
   - **`MessageList.test.tsx`:**
     - a chat whose pref is `gold` renders the list element with an inline background containing `#715625`;
     - a chat with no pref has no inline background.
   - **`store/realStore.test.tsx`:**
     - boot loads `defaultBackground` from a stubbed `GET /chat-background`;
     - a failing call leaves null and the chats still load.

### Read first
`AGENTS.md`, `docs/audit/chat-backgrounds-plan.md` §5 and §8, `apps/web/src/lib/api.ts:185-200` and `:755-800`, `apps/web/src/mock/api.ts:2460-2500`, `apps/web/src/store/store.ts:240-260` and `:1030-1055`, `apps/web/src/store/realStore.ts:3051-3100` and `:4550-4600`, `apps/web/src/components/MessageList.tsx:20-60` and `:195-235`, `packages/ui-tokens/src/index.ts`.

### Allowed files
`apps/web/src/lib/api.ts`, `apps/web/src/mock/api.ts`, `apps/web/src/lib/chatBackground.ts`, `apps/web/src/lib/chatBackground.test.ts`, `apps/web/src/store/store.ts`, `apps/web/src/store/realStore.ts`, `apps/web/src/store/realStore.test.tsx`, `apps/web/src/components/MessageList.tsx`, `apps/web/src/components/MessageList.test.tsx`, `apps/web/src/store/reload.test.tsx`, `apps/web/src/store/realStore.forward.test.tsx`, `apps/web/src/store/realStore.media.test.tsx`, `apps/web/src/store/realStore.topics.test.tsx`, `work/T-0461-web-render-backgrounds.md`.

If any other test breaks (for example a test that builds a full store object and now misses the new field), stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot chatBackground MessageList realStore
pnpm gate
```

### Acceptance
- Web paints each chat's effective background: the per-chat value, else the default, else slate, either as a preset or as an image with dim.
- With no prefs, every chat looks exactly as before (no inline style).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Status: review. The spec is fully implemented; `pnpm gate` ends with GATE PASS and all changed files are inside the Allowed files.**

### What I did
- `lib/api.ts`: added `backgroundPreset` / `backgroundImageId` / `backgroundDim` to `chatPrefSchema` as `.nullable().optional()`; exported `ChatBackgroundChoice`; added `getChatBackgroundDefault()` calling `GET /chat-background` and unwrapping `defaultBackground`.
- `mock/api.ts`: `GET /chat-background` now returns `{ defaultBackground: { backgroundPreset: null, backgroundImageId: null, backgroundDim: null } }`.
- New `lib/chatBackground.ts`: `effectiveBackground(pref, fallback)` (pref wins, else default, else `slate`; unknown preset id → `slate`; image dim defaults to 40) and `chatBackgroundStyle(effective)` (`{}` for slate, a 22 px dot radial-gradient for other presets, and a dim layer + `/api/backgrounds/<encoded id>` for images).
- `store/store.ts`: added `defaultBackground: ChatBackgroundChoice | null` and `refreshDefaultBackground(): Promise<void>` to `ChatStoreState`, plus the mock implementation.
- `store/realStore.ts`: added `getChatBackgroundDefault()` to `ApiClient` and `realApi`; initial/stop/sign-out state reset `defaultBackground` to `null`; `boot` fires `void get().refreshDefaultBackground()` without blocking the chat list; the public `refreshDefaultBackground` is generation-guarded and leaves the value null on failure.
- `components/MessageList.tsx`: computes the style once and applies it to all three `chat-background` elements.
- Tests: new `lib/chatBackground.test.ts` (precedence, unknown id, slate `{}`, navy hexes, image dim 55, image default dim 40); `MessageList.test.tsx` (gold preset inline background; no pref → no inline background); `store/realStore.test.tsx` (boot loads the default; a failure leaves null and chats still load, plus the method added to `fakeApi`); and the `getChatBackgroundDefault` stub added to the four other `ApiClient` literals (`reload.test.tsx`, `realStore.forward.test.tsx`, `realStore.media.test.tsx`, `realStore.topics.test.tsx`) after the lead approved those files.

### Commands and real results
- `pnpm install`: done (exit 0).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot chatBackground MessageList realStore`: 192 passed, 1 failed first (jsdom serialises hex to `rgb()`, fixed the test); re-ran `… MessageList`: 21 passed.
- `pnpm gate`: `gate: 14 changed file(s) against main`; `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/web`; `scope: every changed file is inside the Allowed files`; `GATE PASS`.

### Blocked / needs a decision
None. The earlier blocker (the four other `ApiClient` test literals) is resolved: the lead added those files to Allowed files and I added the one `getChatBackgroundDefault` stub to each, keeping `ApiClient.getChatBackgroundDefault` required.

### Security checklist
No secrets, routes, deletes or permissions were added; this is a read-only client render change. `getChatBackgroundDefault` only reads the caller's own default.

## Review (written by Claude)

Approved (lead, 2026-10-07). effectiveBackground and chatBackgroundStyle (lib/chatBackground.ts) resolve per-chat, then default, then slate; slate gives no inline style, so today's look is unchanged. Presets paint the token dot on its ground; images use a dim overlay plus /api/backgrounds/<id>. The store loads defaultBackground at boot without blocking. MessageList styles all three background elements. Lead widened Allowed files for the 4 ApiClient fakes (one stub each). Pre-review clean.
