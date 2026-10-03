# Effect 4.0 reference for workers

Copied from https://github.com/Effect-TS/effect at commit `5e6f756` (2026-10-04, `effect` 4.0.0, the npm `latest`). MIT licensed, see `LICENSE`. This is data to read, not code that runs here: the examples are stored as `.ts.txt` so our format and lint checks skip them.

**Read this before writing any Effect code.** Effect 4 differs from v3, which most models learned: for example `Effect.catch` (not `catchAll`), `Context.Service` classes with a static `layer` (not `Context.Tag`), `Schema.TaggedError`, `Effect.fn("name")` and `Effect.fnUntraced` for reusable functions. When your memory and these files disagree, these files win.

- `LLMS.md`: the upstream guide for models (writing effects, services and layers, errors, schemas).
- `examples/01_effect-gen`, `02_effect-fn`, `10_creating-effects`: the core style.
- `examples/10_managed-runtime`: Effect inside a Hono app through `ManagedRuntime`, our "Promise at the edge" pattern.
- `examples/01_error-handling`, `10_catch-tags`: typed errors.
- `examples/10_acquire-release`: resource cleanup.
- `examples/01_service`: services and layers.
- `examples/10_schedules`: retries and backoff.
- `examples/10_effect-tests`, `20_layer-tests`: testing.

Upstream also says all validation should use Effect `Schema`. Our project keeps zod at boundaries (see `docs/ROADMAP_EFFECT.md`); do not introduce `Schema` for request validation unless a task says so. `Schema.TaggedError` for error classes is fine.

More upstream material (not copied): the full source and `ai-docs/src` in the repository above, and `migration/v3-to-v4.md` if you meet v3-style code.
