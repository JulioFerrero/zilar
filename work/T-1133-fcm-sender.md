---
id: T-1133
title: "Native push 2/6: FCM HTTP v1 sender — OAuth token minted with node:crypto (RS256 JWT, cached ~55 min, one shared refresh) and a data-only, ids-only send with UNREGISTERED → gone; FCM env in push config"
status: todo
milestone: M5
branch: task/T-1133-fcm-sender
model: auto
effort: default
depends_on: [T-1129]
estimate: 0.3 day
---

# T-1133: The FCM sender

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-11: Android push through FCM, with no text in the push. This is Task 2 of `docs/audit/native-push-plan.md` §7. It runs beside T-1132 (separate files).

**Facts** (the plan §2):
- **The endpoint:** `POST https://fcm.googleapis.com/v1/projects/<project_id>/messages:send` with `Authorization: Bearer <token>`.
- **The token:** an RS256 JWT signed with the service account's `private_key`, with the claims `iss` (`client_email`), `scope` (`https://www.googleapis.com/auth/firebase.messaging`), `aud` (`https://oauth2.googleapis.com/token`), `iat` and `exp` (`iat + 3600`). It is exchanged at `https://oauth2.googleapis.com/token` (`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`).
- **The existing push config:** `pushEnvSchema` at `apps/server/src/push/config.ts:32-68`, and `pushConfigError` at `:161-184`, which reports only key names (`:85-102`).
- **The existing Web Push sender**, for comparison: `apps/server/src/push/sender.ts`, which maps 404/410 to gone (`:65-71`).

### What to build
1. **A new `apps/server/src/push/fcm-token.ts`:** `createFcmTokenProvider({ serviceAccount, fetch?, now? }): { token(): Promise<string> }`.
   - It uses only `node:crypto` and `fetch`; **no new dependency**.
   - It caches the token for `expires_in - 300` seconds, and concurrent callers share one in-flight refresh.
   - The private key never appears in a log, error message or thrown value.
2. **A new `apps/server/src/push/fcm.ts`:** `createFcmSender({ projectId, tokens, fetch? }): { send(token, data: { chatId, messageId, serverId }): Promise<{ gone: boolean }> }`.
   - The body is exactly the plan §2.4 message: `data` only, `android.priority: "high"`, `ttl: "3600s"`, and no `notification` block.
   - `404 UNREGISTERED` gives `{ gone: true }`.
   - Any other non-2xx throws a send error that carries only the HTTP status and the FCM error code (no token, no body text).
3. **`config.ts`:** add `FCM_SERVICE_ACCOUNT_JSON` (a secret, a one-line JSON string) and an optional `FCM_PROJECT_ID`, read from the JSON's `project_id` when it is absent.
   - FCM is **optional:** with neither key set, the server starts as today.
   - With an invalid JSON, or one missing `client_email`/`private_key`, `pushConfigError` names the key and never the value.
   - The server wiring is Task 4, so **do not touch `main.ts`**.
4. **Tests** (keys), in new files `apps/server/src/push/fcm-token.test.ts` and `apps/server/src/push/fcm.test.ts`. **No real Google call:** generate an RSA key pair in the test with `node:crypto` and fake `fetch`.
   - **The JWT:** it verifies with the public key, has `alg: RS256`, and carries the right `iss`, `scope` and `aud`, with `exp - iat = 3600`.
   - **The cache:** two calls give one exchange; a refresh happens after `expires_in - 300`; concurrent calls share one exchange.
   - **The sender:**
     - the body matches the plan §2.4 exactly, with no `notification` key;
     - 404 `UNREGISTERED` gives `{ gone: true }`;
     - 400, 403 and 503 throw without the token or the private key in the message.
   - **The config:** a bad `FCM_SERVICE_ACCOUNT_JSON` reports the key name, and the value is absent from the error text.

### Read first
`AGENTS.md`, `docs/audit/native-push-plan.md` §2, `apps/server/src/push/sender.ts` and `apps/server/src/push/config.ts`.

### Allowed files
`apps/server/src/push/fcm-token.ts`, `apps/server/src/push/fcm.ts`, `apps/server/src/push/fcm-token.test.ts`, `apps/server/src/push/fcm.test.ts`, `apps/server/src/push/config.ts`, `work/T-1133-fcm-sender.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/push/fcm-token.test.ts src/push/fcm.test.ts --reporter=dot
pnpm gate
```

### Acceptance
The Checks pass.

---

## Report (written by the worker when done)

## Review (written by Claude)
