# Lean code: how we rewrite a feature

Julio, 2026-10-19: "the problem is not naming a function something shorter or make two lines into one, the problem is that we have 240.000 of slop code".

Trimming a file keeps its shape. A rewrite gives the feature a new, smaller shape. These rules are for every rewrite task and for new code.

## The process (rewrite tasks)

1. **Start from the behaviour list in the spec, not from the old code.** The spec lists what a user sees and does, and what the server must guarantee. Read the old code only to answer a question the list leaves open. Never copy it across, and never translate it line by line.
2. **The budget is the limit, not a target.** The spec gives a line budget per new file and in total. Count with `wc -l` before you set `status: review`. If the budget cannot hold a listed behaviour, stop and say which one in the Report. Do not drop the behaviour silently, and do not overrun quietly. **Every file you touch counts:** moving code into a file outside the budget table, or into a neighbour file, does not meet a budget. The net over `apps/` and `packages/` is what the lead checks.
3. **Delete the old code in the same task.** No compatibility shim, no second path behind a flag, no "kept for now" file. Callers move to the new code in the same commit.
4. **Report lines before and after for every file you touched or deleted**, plus the total.

## Rules for every line

**One home per piece of logic.**
- Logic both apps need (state, derived values, actions, formatting, rules) lives once in `packages/client-core` or `packages/chat-core`.
- `apps/web` and `apps/mobile` keep only markup, platform APIs and gestures. If web and phone would write the same `if`, it belongs in a package.
- A server rule lives in one service function. The route only reads, calls and returns.

**Trust the types and the contract.**
- Data decoded by `packages/api-contract` or an Effect `Schema` at the boundary is valid; don't check it again.
- Don't guard states the types make impossible: no `?? []` on a required array, no `if (!x) return` on a non-optional value, no `typeof` checks on typed fields.
- Pass the decoded payload through (`{ ...payload, actorId }`) instead of copying fields one by one.

**No layers that do nothing.**
- No wrapper, hook or helper with one caller and no logic of its own; inline it.
- No re-export files, no type aliases of contract types, and no local interface that repeats a contract type.
- No `try/catch` that rethrows or maps to the same error. `handler()` on the server and `fromApi` in the clients already render errors.
- No `Effect.gen` around a single promise; a plain `async` body or `Effect.promise` alone will do.

**Data over branches.** A table (`Record<Kind, …>`) beats a `switch` or `if` chain that maps one value to another.

**Use the platform and the libraries we have before writing our own:**
- Base UI on web;
- Expo, React Native, Reanimated and TrueSheet on the phone;
- Effect `Schema` for validation;
- the browser's and React's own features.

Adding a new library needs the spec's OK.

**No speculative code:**
- no options nobody passes;
- no "future" parameters;
- no generic machinery for one use;
- no defensive defaults for configs we control.

**Comments** follow `docs/COMMENTS.md`: a WHY the code cannot say, or nothing.

**Tests** only where `AGENTS.md` says (auth and keys, permissions and money, the message pipeline). A rewrite keeps the crucial tests passing and deletes the tests of code it deletes.

## Smells a reviewer rejects

- A new file whose exports are used in one place.
- Two functions in web and phone with the same body.
- A component over 300 lines that mixes data loading, state and markup; split the state into a client-core view model.
- More than three `useState` for one form; use one state object or a reducer.
- `useEffect` that copies props into state; derive the value instead.
- Error strings built in several places for one failure; one map, one place.
- A comment that explains what the next line does.
