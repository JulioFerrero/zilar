# @galena/agent-drivers

The interface the Galena gateway uses to control the AI engine inside a desk, plus the first
implementation: a driver for **OpenCode v2's HTTP API**.

A driver turns one engine into a small, uniform surface: create a session in a directory, send it a
prompt, stream what it does, answer its permission requests, and cancel it. Because the interface is
shaped like the Agent Client Protocol, another engine (Goose, Codex, the Claude Agent SDK) can be
added later and swapped per AI without touching the gateway.

## Usage

```ts
import { createOpenCodeV2Driver, defaultWorkerRules } from '@galena/agent-drivers';

const driver = createOpenCodeV2Driver({
  baseUrl: 'http://127.0.0.1:4500',
  password: 'CHANGE_ME',
});

const session = await driver.start({
  directory: '/path/to/desk',
  model: { providerID: 'opencode', id: 'deepseek-v4.1-flash' },
  rules: defaultWorkerRules(),
});

const prompt = await driver.prompt(session, 'Summarise the repository layout.');

const controller = new AbortController();
for await (const event of driver.events(session, { after: prompt, signal: controller.signal })) {
  switch (event.type) {
    case 'text':
      console.log(event.text);
      break;
    case 'permission_request':
      await driver.answerPermission(session, event.requestId, 'allow_once');
      break;
    case 'done':
      console.log('run finished:', event.outcome);
      break;
    case 'error':
      console.error(event.message);
      break;
  }
}
```

## Events

`events()` yields a discriminated union, one item at a time and in order:

- `text` / `reasoning` — assistant prose, emitted as deltas as the message grows.
- `tool_call` / `tool_result` — a tool the engine ran, with its input and final status.
- `permission_request` — the engine is waiting for a person's decision.
- `done` — the run ended (`succeeded`, `failed` or `interrupted`); the stream ends after it.
- `error` — the stream hit a transport or parse problem and stopped.

`prompt()` returns a `PromptRef`, and `events(session, { after })` only processes messages newer
than that prompt. A follow-up prompt on the same session therefore streams just its own run and ends
on its own `idle`, instead of replaying the earlier run. If the prompt message has already scrolled
out of the page, the driver falls back to comparing `time.created` against the `PromptRef`.

## Polling, not SSE

The driver reads the run by **polling** `GET /api/session/{id}/message` and
`GET /api/session/{id}/permission` every `pollIntervalMs` (default 2000). It does not use the
`GET /api/event` SSE stream.

Why: in the pinned OpenCode v2 OpenAPI spec, `/api/event` describes each event as an opaque
JSON-encoded string (`V2EventEncoded` is `type: string, contentMediaType: application/json`), so the
event shapes are not part of the contract and could change between daily releases. Message and
permission polling uses endpoints with explicit, validated schemas.

The trade-off is latency (up to one poll interval) and pagination: the driver asks for the newest
100 messages (`limit=100&order=desc`), so a run that produces more than that between two polls could
lose the oldest ones. If that becomes a problem, switch to SSE once its event schema is stable.

## Permission rules

Rules are `{ action, resource, effect }`, with `effect` of `allow`, `ask` or `deny`. Session rules
override the agent's rules, and **later rules win**, so `defaultWorkerRules()` lists broad asks
first, narrow allows second, and denies last. The shell tool's action is `shell` (not `bash`).
