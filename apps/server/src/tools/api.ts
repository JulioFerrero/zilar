// Tools module on the Effect `HttpApi` adapter (T-0559): the same methods,
// paths, statuses (204 on delete, 501 without a runner), bodies, audit calls
// and per-route step order as the router, mounted by the Effect edge
// (`apps/server/src/effect/edge.ts`).
// Its service runs on effect/sql.
//
// The revert and run bodies are decoded manually inside their handlers
// (Effect Schema, same rules as the old zod schemas) instead of as endpoint
// payloads, so each route keeps its exact order: session, then decode (400
// "Invalid run body"), then access (404 "Tool not found" unless the caller
// is a manager), then the run limiter (429), then the runner check (501).
// No decode text changes: every failure answers byte-identical codes and
// messages. Tool run output and input never appear in a log line, as before.
//
// T-0976 size split: the handlers live in `./routes`, the wire mappers and
// the body/limit/error helpers in `./wire`, and the permission helpers in
// `./access`. This path re-exports the same public names it always did.

export { createToolsApi, TOOL_RUN_RATE_LIMIT_MAX, TOOL_RUN_RATE_LIMIT_WINDOW_MS } from './routes';
export type { ToolsApiDependencies } from './routes';
export { MAX_TOOL_RUN_INPUT_BYTES } from './wire';
