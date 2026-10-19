---
id: T-2220
title: "Web search keys W2b (shared + web): provider labels and key pages, key-check web choices and a used-for line, grouped Add key picker and Models / Web search sections on the web Connections page"
status: merged
milestone: M5
branch: task/T-2220-web-search-keys-web
model: deepseek/deepseek-flash
effort: default
estimate: 45 min
---

# T-2220: Web search keys (shared + web)

## Spec (written by Claude, do not edit)

### Why
This is the web half of the approved design: `docs/design/mockups/web-search/README.md` plus `AddKey.dc.html` and `Connections.dc.html` (Julio, 2026-10-19). Read the README and those two boards first.

T-2219 (merged) added the contract parts in `packages/api-contract/src/connections.ts`:
- the five ids in `PROVIDER_IDS`;
- `WEB_SEARCH_PROVIDER_IDS`;
- `WEB_CAPABILITIES`.

The phone twin is a later task that reuses the shared helpers added here.

### Facts (read by the lead on 2026-10-19)
1. **Labels and key pages.**
   - `AI_PROVIDERS` (`packages/chat-core/src/ai.ts:255-264`) gives every label through `providerLabel`.
   - `LLM_PROVIDER_IDS` (`:267`) stays as it is.
   - `KEY_PAGES` (`packages/chat-core/src/new-ai.ts:69-76`) feeds `keyPageFor`.
2. **The key-check hook.** `useKeyCheck` (`packages/client-core/src/key-check.ts:90-263`) loads `listConnections` once and keeps only active LLM rows (`:127`). It builds `choices` with `providerChoices`, and `providerText` looks only in `choices` (`:237`). It is shared by the New AI flow and both Add key dialogs.
3. **The web picker.**
   - `ProviderStep` (`apps/web/src/components/ais/new-ai/ProviderStep.tsx`) renders `Combobox` with `dot` on rows that have a key. It is used by New AI and by `AddKeyDialog` (`apps/web/src/routes/ConnectionsPage.tsx:113-187`).
   - `Combobox` (`apps/web/src/components/ui/combobox.tsx`) is Base UI. `ComboboxOption` (`:7-12`) has no group or tag, and the list renders flat (`:112-135`).
4. **The web Connections page.** `ConnectionsPage` renders one `<ul aria-label="Connections">` of `ConnectionRow` (`ConnectionsPage.tsx:81-97`). The row meta line is reason · label · host · date (`:343-348`).
5. **Colours.** `#8a8a8a` on the boards is `--subtle-foreground` (`text-subtle-foreground`), and `#a1a1a1` is `text-muted-foreground` (`apps/web/src/index.css:80-81`).
6. **Mock data.** The mock seed (`packages/mock-backend/src/domains/connections/seed.ts`) has openai, anthropic and an openai-compatible row. The mock create route accepts any provider string.

### Steps
1. **chat-core:**
   - Add to `AI_PROVIDERS`: `brave` → "Brave Search", `exa` → "Exa", `firecrawl` → "Firecrawl", `jina` → "Jina", `tavily` → "Tavily".
   - Add to `KEY_PAGES`:
     - brave: `https://api-dashboard.search.brave.com/app/keys`
     - exa: `https://dashboard.exa.ai/api-keys`
     - firecrawl: `https://www.firecrawl.dev/app/api-keys`
     - jina: `https://jina.ai/api-dashboard/key-manager`
     - tavily: `https://app.tavily.com/home`

     The lead checked each URL resolves (Exa's answered 429 to curl).
2. **client-core `key-check.ts`:**
   - From the same `listConnections` result, keep the set of providers with an active key (all providers, not only LLM).
   - Return `webChoices`: the five `WEB_SEARCH_PROVIDER_IDS` in contract order as `{ id, label, hasKey, tag }`.
   - Every model choice whose id is in `WEB_CAPABILITIES` (deepseek) also gets a `tag`.
   - **Tag text:** "Search · Read" when the provider has both, "Search" when it has search only.
   - `providerText` looks in both lists.
   - Export a pure `webUseText(connection, all: readonly ConnectionView[]): string | undefined`:
     - **deepseek:** "Model, search, read".
     - **A web search connection:** the capabilities it serves. For each of search and read, it serves that capability when it is the first active web search connection in `all` (createdAt order, as the server picks) that has it. The text is "Search · Read", "Search" or "Read", or "Backup" when it serves neither.
     - **Anything else:** `undefined`.
3. **Web `Combobox`:** `ComboboxOption` gains optional `group?: string` and `tag?: string`.
   - **Groups:** when options carry `group`, render them grouped in first-seen order, using Base UI's grouped list (`Combobox.Group`, `Combobox.GroupLabel`, `Combobox.Collection`). Read the installed `@base-ui/react` combobox types for the exact API.
   - **Group label:** `px-2.5 pt-2 pb-1 text-[12px] font-medium text-subtle-foreground`.
   - **Tag:** `font-mono text-[12px] text-subtle-foreground`, placed after the label and before the dot.
   - Search, Empty and the footer item keep working.
   - Options without `group` render exactly as today (New AI).
4. **`ProviderStep`:** a new prop `withWebSearch?: boolean`, passed only by `AddKeyDialog`. When true:
   - the model choices get `group: 'Models'`;
   - `keys.webChoices` are appended with `group: 'Web search'`;
   - every option passes its `tag` and its `dot`.

   The New AI dialog passes nothing, so no web search rows ever show there.
5. **`ConnectionsPage`:**
   - Split `visible` into Models (provider not in `WEB_SEARCH_PROVIDER_IDS`) and Web search.
   - Render each non-empty group as a section with a heading row like the board: `flex items-baseline gap-2 px-1 pb-2`, then `<h2 className="text-[13px] font-medium">`. The Web search heading is followed by `<span className="text-[13px] text-subtle-foreground">for AIs whose model has none</span>`.
   - Below the heading goes the existing list surface, with its own `aria-label`: "Models" or "Web search".
   - Sections are separated with `gap-6`.
   - In `ConnectionRow`, the meta line becomes reason · label · host · `webUseText` · date (each part only when present). Pass the full `visible` list for `webUseText`.
   - The empty state stays as it is.
6. **Mock seed:** append three rows:
   - `deepseek`, label "Personal key", 2026-09-23;
   - `brave`, no label, 2026-10-19T09:00;
   - `jina`, no label, 2026-10-19T09:05.

   The lead and the phone twin check against these rows.

### Allowed files
- `packages/chat-core/src/ai.ts`
- `packages/chat-core/src/new-ai.ts`
- `packages/client-core/src/key-check.ts`
- `apps/web/src/components/ui/combobox.tsx`
- `apps/web/src/components/ais/new-ai/ProviderStep.tsx`
- `apps/web/src/routes/ConnectionsPage.tsx`
- `packages/mock-backend/src/domains/connections/seed.ts`
- `work/T-2220-web-search-keys-web.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes; no new tests (UI).
- The lead checks in web mock mode, comparing against `AddKey.dc.html` and `Connections.dc.html`:
  - Connections shows a Models section (DeepSeek "Personal key · Model, search, read · Sep 23").
  - It shows a Web search section with the hint; Brave Search reads "Search · Oct 19" and Jina "Read · Oct 19".
  - Add key's dropdown shows the "Models" and "Web search" groups with tags.
  - The New AI provider step shows no web search rows and no groups.

---

## Report (written by the worker when done)

### What I did
- **chat-core:** added the five web search labels to `AI_PROVIDERS` and their key pages to `KEY_PAGES`; added the optional `tag` to `ProviderChoice`.
- **client-core `key-check.ts`:** kept the active-provider set from the same `listConnections` result, added `webChoices` for the five contract ids with `label`, `hasKey` and capability `tag`, tagged model choices in `WEB_CAPABILITIES` (DeepSeek), made `providerText` search both lists, and exported the pure `webUseText`. The oldest active web search key per capability wins, matching the server's `created_at ASC` pick.
- **Web `Combobox`:** `ComboboxOption` gained optional `group` and `tag`. Options carrying a `group` render through `Combobox.Group` / `GroupLabel` / `Collection` in first-seen group order; ungrouped options keep the flat list. The tag renders in mono after the label and before the dot.
- **`ProviderStep`:** `withWebSearch` groups model choices under "Models", appends `keys.webChoices` under "Web search", and passes tags and dots only in that mode. The New AI dialog still passes nothing, so it renders as before with no groups and no tags.
- **`ConnectionsPage`:** split rows into Models and Web search sections (the second with the muted hint), each in its own list with an `aria-label`, separated by `gap-6`; the row meta now appends `webUseText` before the date and receives the full visible list.
- **Mock seed:** added DeepSeek ("Personal key", 2026-09-23), Brave (2026-10-19T09:00) and Jina (2026-10-19T09:05), all active.

### Files changed
- `packages/chat-core/src/ai.ts`
- `packages/chat-core/src/new-ai.ts`
- `packages/client-core/src/key-check.ts`
- `apps/web/src/components/ui/combobox.tsx`
- `apps/web/src/components/ais/new-ai/ProviderStep.tsx`
- `apps/web/src/routes/ConnectionsPage.tsx`
- `packages/mock-backend/src/domains/connections/seed.ts`
- `work/T-2220-web-search-keys-web.md`

### Commands run
- `pnpm install` — done (1299 resolved, completed in 12.5s).
- `pnpm gate` — first run: failed on format for `ProviderStep.tsx` and `combobox.tsx`; fixed with `pnpm exec prettier --write` on those two files.
- `pnpm gate` — second run: failed typecheck, `ProviderStep.tsx(12,20) TS2339: Property 'tag' does not exist on type 'ProviderChoice | …'`; fixed by adding the optional `tag` to `ProviderChoice`.
- `pnpm gate` — final run: **GATE PASS**, with these summary lines:
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.0s)
  PASS  lint  (0.7s)
  PASS  typecheck  (0.6s)
  PASS  effect  (0.4s)
  PASS  build @zilar/server  (0.5s)
  PASS  tests @zilar/chat-core  (1.0s)
  PASS  tests @zilar/client-core  (1.2s)
  SKIP tests @zilar/mock-backend (no nearby test files)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  ...
  GATE PASS
  ```
  The gate also warned, without failing, that `apps/web/src/routes/ConnectionsPage.tsx` is 466 lines (main 421) and `packages/chat-core/src/ai.ts` is 516 lines (main 511), both soft-limit warnings.
- One-off logic check of `webUseText` with the mock-style rows (not a committed test): printed `Model, search, read | Search | Read | Backup` for DeepSeek, Brave, Jina and a revoked Firecrawl.

### Problems, deviations, open questions
- No tests added: the spec says UI, and no test files were touched. The gate skipped web and mock-backend tests because there are no nearby test files.
- I did not run the web app in mock mode; the acceptance visual check is left to the lead as specified.


## Review (written by Claude)

Approved; the pre-review was clean (0 findings). +245 lines: a feature UI plus shared helpers and the mock seed.

**What changed:**
- **Labels and key pages:** five provider labels and key pages in chat-core.
- **`key-check`:** `webChoices` with tags, a tag on DeepSeek, and `webUseText` (deepseek → "Model, search, read"; a web search key → the capabilities it serves in createdAt order, or "Backup").
- **Web `Combobox`:** `group` and `tag`, using Base UI's grouped list.
- **`ProviderStep`:** `withWebSearch`, passed only by Add key.
- **Connections:** split into Models and Web search sections.

**Lead checks** (web mock, against `AddKey.dc.html` and `Connections.dc.html`):
- **Connections:**
  - Models: DeepSeek "Personal key · Model, search, read · Sep 23".
  - Web search, with the hint "for AIs whose model has none": Brave Search "Search · Oct 19", Jina "Read · Oct 19".
- **Add key dropdown:**
  - "Models": DeepSeek tagged "Search · Read", green dots on rows with a key.
  - "Web search": Brave Search "Search"; Exa, Firecrawl, Jina, Tavily "Search · Read".
  - Filtering "Jina" keeps its group label.
  - Picking Brave Search moves to the Key step with a "Get one" link.
- **New AI** provider list: OpenAI, Anthropic, DeepSeek, Google, OpenRouter, Together AI, xAI. No groups, no web search rows.
- No page errors.
