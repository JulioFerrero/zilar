# How Zilar's AIs reach model providers: options

Written 2026-10-14 for Julio's decision. All facts below were checked in the code or on the live server that day.

## Where we are
- **The plan named LiteLLM as the gateway** (`docs/PROJECT_PLAN.md:59,85`): it would hold the real provider keys and give each AI a capped stand-in ("virtual") key with a budget.
- **The server is written for that:**
  - `apps/server/src/ai/litellm-client.ts` creates a virtual key per AI (`/key/generate` with `max_budget`, `rpm_limit`, `tpm_limit`) and registers the owner's key as a private model (`/model/new`, entry shape in `apps/server/src/ai/model-entry.ts`);
  - `apps/server/src/ais/usage.ts` reads each AI's spend back from LiteLLM;
  - the agent loop calls `<LITELLM_BASE_URL>/chat/completions` with the AI's virtual key (`apps/server/src/agents/tool-loop.ts:223`, `dm-turn.ts:48-49`).
- **Production has no LiteLLM.** The live server's `LITELLM_BASE_URL` is the compose placeholder `http://127.0.0.1:9` (`deploy/coolify/docker-compose.app.yml:181`); no LiteLLM container runs; the live database has no AIs and no provider keys. AI replies can't work in production today. Nobody has noticed, because nobody has created an AI yet.
- **The model call is made by our own server process.** Tools run in a sandbox (`apps/server/src/sandbox/`), but the call to the model doesn't. So the virtual key never leaves our server either; it only separates our server from the real key.
- **Provider keys are already stored encrypted** in our database (`provider_connections.encrypted_key`, `apps/server/src/connections/crypto.ts`).
- **No AI SDK is installed** yet (no `ai`, `@ai-sdk/*` or `@effect/ai*` in any `package.json`).

## What a gateway gives us, and what we actually need
| Need | Why | LiteLLM | Built in our server |
|---|---|---|---|
| Speak each provider's API | Anthropic, Gemini and others aren't OpenAI-shaped | Yes, 100+ providers | A library does it: the Vercel AI SDK (`@ai-sdk/*`, incl. `openai-compatible`) or Effect AI (`@effect/ai-*`) |
| Per-AI budget and rate limit | An AI loop must not burn the owner's credit | Yes (virtual keys) | We count tokens per call and stop at the limit (a table plus a check before each call) |
| Spend per AI | Shown in the AI's settings | Yes (spend logs) | The same token table, priced from models.dev (T-1395) |
| Keep keys out of reach | A leak of one AI must not leak the key | Yes, the gateway holds them | Keys stay encrypted at rest and are decrypted only in the server process for each call, the same trust boundary as today |
| Model catalog | Pick models with prices | Its own model list | models.dev (T-1395), whatever we choose |

## The options
**A. Deploy LiteLLM, as planned.**
- *Work:* add a LiteLLM service and its own Postgres database to the Coolify app, set `LITELLM_BASE_URL` and `LITELLM_MASTER_KEY`, and pin an exact image digest. Then test the AI flow end to end. About 1 worker task plus a Coolify change Julio approves.
- *Cost:* a Python service with its own database. It needs memory on the VPS (about 0.5–1 GB is typical), its own upgrades, and its own backups.
- *Risk:* supply chain. The plan itself notes that two LiteLLM releases on PyPI shipped credential-stealing malware in March 2026 (`PROJECT_PLAN.md:185`), and this service would hold every user's provider key. Pinning a digest and upgrading only on purpose limits that.
- *Good:* the code exists, the features are mature, and new providers come for free.

**B. A small gateway inside our server, built on a library (recommended).**
- *Work:* replace the LiteLLM client with an in-process call through one SDK. That needs a token-usage table, a budget check per call, and a spend view, then removing the LiteLLM code. About 2–3 worker tasks: the provider calls, usage and budgets, and cleanup.
- *Cost:* no new service; it runs in the existing server container.
- *Risk:* we own the budget logic, so it needs tests (money: tests are allowed). The SDK's provider coverage is narrower than LiteLLM's, but it includes OpenAI, Anthropic, Google, DeepSeek, xAI, OpenRouter and any OpenAI-compatible endpoint, which covers our list plus T-1396.
- *Good:* fewer moving parts, TypeScript/Effect like the rest of the server, and keys never sent to another service.
- *Which SDK:* Effect AI fits the codebase (Effect 4 everywhere). The Vercel AI SDK is the more widely used one. A short spike can pick.

**C. OpenRouter only.**
- *Work:* small. Users bring one OpenRouter key, and the agent calls OpenRouter's OpenAI-shaped API directly.
- *Cost:* OpenRouter adds a fee on top of model prices; users who already have an OpenAI or Anthropic key can't use it directly.
- *Good:* hundreds of models behind one key; OpenRouter tracks spend too. It could be the *first* step of B rather than an alternative.

**D. A hosted gateway** (Cloudflare AI Gateway, Portkey, Helicone).
- *Cost:* another account, and a third party sees every prompt and the users' keys. That goes against the product's privacy stance, so not recommended.

## Recommendation
**B.** Keys are bring-your-own and the model call already happens inside our server, so a separate gateway adds a service to run, back up and patch while protecting the key no more than our own encrypted storage does. The parts we'd write ourselves (token counting and a budget check) are small and testable. **A** is the quickest way to working AIs if speed matters more than ops weight.

Either way, the first step is the same: make AI replies work in production, and add a live check that creates an AI with a real key (Julio's) and gets an answer.
