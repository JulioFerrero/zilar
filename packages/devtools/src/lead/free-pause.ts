import fs from 'node:fs';
import path from 'node:path';
import { Result, Schema } from 'effect';
import { fallbackModel } from './fallback.js';
import { goPauseConfigPath, readConfigJson, warnBadConfig } from './go-pause.js';
import { GO_MUSE, PAID_MUSE, isFreeListing } from './models.js';

// Every free listing shares one pause: after a gateway abuse refusal the lead leaves
// free listings alone for a few hours and starts new sessions on the paid step. The
// setting lives in config.json next to state.json, read on every call.
export const FREE_PAUSE_HOURS = 6;

const freePauseConfigSchema = Schema.Struct({
  freePausedUntil: Schema.optional(Schema.String),
});

function readRaw(configPath: string): string | undefined {
  try {
    return fs.readFileSync(configPath, 'utf8');
  } catch {
    return undefined;
  }
}

function parseConfig(raw: string | undefined, configPath: string): Record<string, unknown> {
  if (raw === undefined) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warnBadConfig('free-pause', configPath, 'not valid JSON');
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    warnBadConfig('free-pause', configPath, 'config must be a JSON object');
    return {};
  }
  return { ...(parsed as Record<string, unknown>) };
}

function readConfig(configPath: string): Record<string, unknown> {
  return parseConfig(readRaw(configPath), configPath);
}

// The ISO timestamp the free listings stay paused until, or undefined when absent.
export function freePause(
  now: Date = new Date(),
  configPath: string = goPauseConfigPath(),
): { until: string } | undefined {
  const parsed = readConfigJson(configPath, () =>
    warnBadConfig('free-pause', configPath, 'not valid JSON'),
  );
  if (parsed === undefined) {
    return undefined;
  }
  const decoded = Schema.decodeUnknownResult(freePauseConfigSchema)(parsed);
  if (Result.isFailure(decoded)) {
    warnBadConfig('free-pause', configPath, 'freePausedUntil must be an ISO timestamp');
    return undefined;
  }
  const until = decoded.success.freePausedUntil;
  if (until === undefined) {
    return undefined;
  }
  const at = Date.parse(until);
  if (Number.isNaN(at)) {
    warnBadConfig('free-pause', configPath, `freePausedUntil is not a real timestamp: ${until}`);
    return undefined;
  }
  return at > now.getTime() ? { until } : undefined;
}

export function isFreePaused(now: Date = new Date(), configPath?: string): boolean {
  return freePause(now, configPath) !== undefined;
}

// A `goPause` write (or a second lead process) can read the file, add its own
// key and rename over ours between our read and our rename. Re-read before the
// rename and verify the key afterwards, so our pause merges into the newest
// contents instead of being the write that disappears.
const WRITE_ATTEMPTS = 5;

function attemptFreePause(
  configPath: string,
  until: string,
  staging: string,
  verify: boolean,
): boolean {
  const raw = readRaw(configPath);
  const config = parseConfig(raw, configPath);
  config['freePausedUntil'] = until;
  fs.writeFileSync(staging, `${JSON.stringify(config, null, 2)}\n`);
  if (verify && readRaw(configPath) !== raw) {
    return false;
  }
  fs.renameSync(staging, configPath);
  return !verify || readConfig(configPath)['freePausedUntil'] === until;
}

// Writes `freePausedUntil = now + hours`, keeping every other key; a refusal during a
// pause must not extend it on every poll.
export function pauseFree(
  now: Date,
  hours: number,
  reason: string,
  configPath: string = goPauseConfigPath(),
): string {
  const until = new Date(now.getTime() + hours * 3_600_000).toISOString();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const staging = `${configPath}.tmp.${process.pid}`;
  for (let attempt = 0; attempt < WRITE_ATTEMPTS - 1; attempt += 1) {
    if (attemptFreePause(configPath, until, staging, true)) {
      console.log(`LEAD: FREE PAUSED until ${until} (${reason})`);
      return until;
    }
  }
  attemptFreePause(configPath, until, staging, false);
  console.log(`LEAD: FREE PAUSED until ${until} (${reason})`);
  return until;
}

// A free listing is any of the three known ones plus any `opencode/*-free` or
// `opencode-go/*-free` listing.
export function paidStep(model: string, goPaused: boolean): string | undefined {
  const next = fallbackModel(model, goPaused, true);
  if (next !== undefined) {
    return next;
  }
  return isFreeListing(model) ? (goPaused ? PAID_MUSE : GO_MUSE) : undefined;
}

// Pauses free listings for six hours after a gateway refusal; true when this call
// wrote the pause.
export function pauseFreeOnRefusal(
  now: Date,
  model: string,
  refusal: string | undefined,
  configPath: string = goPauseConfigPath(),
): boolean {
  if (refusal === undefined || !isFreeListing(model) || isFreePaused(now, configPath)) {
    return false;
  }
  pauseFree(now, FREE_PAUSE_HOURS, `${model}: ${refusal}`, configPath);
  return true;
}
