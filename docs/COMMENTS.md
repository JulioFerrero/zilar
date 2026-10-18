# Comment rules

The rules apply to every source file under `apps/*/src` and `packages/*/src`. Tests, mocks and generated files are exempt.

Julio, 2026-10-18: the code map total must go down. Comments were 35,839 of 274k source lines (13%), and 3,658 of them only cite task IDs.

## Keep a comment only when it says WHY, and the code can't

Keep, shortened to the fewest lines that still say it:
- **Security, permissions, money and privacy.** Why a check exists, what it blocks, and which input is untrusted. Example: "the stored key is never built from the request, so `..` cannot escape the folder".
- **Protocol and data invariants a reader would break by "simplifying".** Examples: ordering, idempotency, the stanza `from` rule.
- **Platform and library workarounds, with the bug they work around.** Examples: an iOS sheet race, Metro folding a literal env check, React StrictMode double effects.
- **Non-obvious units, limits and formats.** Examples: "ms", "bytes", "UTC", "inclusive".
- **Tool directives.** Examples: `eslint-disable…`, `@ts-expect-error`, `// effect-plain:`, `/// <reference …>`, license headers.

## Delete

- **History:** task IDs (`T-1234`, `(T-0931)`), "moved unchanged", "size split", "was X before", "replaces the old …", "previously", "kept for compatibility with the old …" when the old thing is gone, and "during the transition".
- **Narration that restates the code or the name.** Examples: `// Returns the user`, a JSDoc that repeats the parameter list, "this hook …" introductions for a self-explanatory hook.
- **References to things that no longer exist:** Hono, zod, drizzle, LiteLLM, deleted tests and files, the old mock store.
- **Commented-out code.**
- **Section banners** (`// ---- helpers ----`) in files under 400 lines.

## How to cut

- **Only comment lines change.** No code, no strings, no formatting outside the comment you shorten. `git diff` must show only removed or shortened comment lines, plus a blank line removed where a comment block leaves two blank lines in a row.
- **A multi-line block with one real "why" becomes one or two lines.**
- **JSDoc on exported functions:** keep it only when it adds a WHY or a unit. Delete parameter-by-parameter restatements.
- **New code:**
  - write no comment unless one of the "Keep" cases applies;
  - never cite a task ID in a comment; the task file and the commit message carry the history.
