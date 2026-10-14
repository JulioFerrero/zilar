import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Result, Schema } from 'effect';
import { GO_MUSE, PAID_MUSE } from './models.js';

// T-1421: OpenCode Go's monthly usage ran out, so the lead can pause every Go
// call until a date. The setting lives in config.json next to state.json and is
// read on every call, so setting or clearing it takes effect without restarting
// the autopilot.
export function goPauseConfigPath(): string {
  const override = process.env['ZILAR_LEAD_CONFIG'];
  if (override !== undefined && override.length > 0) {
    return override;
  }
  return path.join(os.homedir(), '.zilar-lead', 'config.json');
}

// Only the `goPausedUntil` field is read; other keys are ignored so the file can
// grow later without this parser rejecting it.
const goPauseConfigSchema = Schema.Struct({
  goPausedUntil: Schema.optional(
    Schema.String.pipe(Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/))),
  ),
});

// A malformed file is reported once per process, then ignored: a typo must never
// stop the lead, it just leaves Go unpaused.
let warnedBadConfig = false;

function warnBadConfig(configPath: string, detail: string): void {
  if (warnedBadConfig) {
    return;
  }
  warnedBadConfig = true;
  console.warn(`lead: ignoring bad go-pause config at ${configPath}: ${detail}`);
}

function validIsoDate(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

// The ISO date Go stays paused until, or undefined when the setting is absent or
// unusable. Go is paused strictly before that date: on the date itself it is
// back (the spec's "paused before it").
export function goPause(
  now: Date = new Date(),
  configPath: string = goPauseConfigPath(),
): { until: string } | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch {
    return undefined; // no file = not paused
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warnBadConfig(configPath, 'not valid JSON');
    return undefined;
  }
  const decoded = Schema.decodeUnknownResult(goPauseConfigSchema)(parsed);
  if (Result.isFailure(decoded)) {
    warnBadConfig(configPath, 'goPausedUntil must be an ISO date like 2026-10-26');
    return undefined;
  }
  const until = decoded.success.goPausedUntil;
  if (until === undefined) {
    return undefined;
  }
  if (!validIsoDate(until)) {
    warnBadConfig(configPath, `goPausedUntil is not a real date: ${until}`);
    return undefined;
  }
  const today = now.toISOString().slice(0, 10);
  return today < until ? { until } : undefined;
}

export function isGoPaused(now: Date = new Date(), configPath?: string): boolean {
  return goPause(now, configPath) !== undefined;
}

export interface ModelRef {
  providerID: string;
  id: string;
}

// While Go is paused a pre-review or the doctor must not start on a Go listing:
// the next step after the Go Muse is the metered paid Muse, so that is what runs
// instead.
export function withoutPausedGoModel(model: ModelRef, goPaused: boolean): ModelRef {
  if (!goPaused || `${model.providerID}/${model.id}` !== GO_MUSE) {
    return model;
  }
  const slash = PAID_MUSE.indexOf('/');
  return { providerID: PAID_MUSE.slice(0, slash), id: PAID_MUSE.slice(slash + 1) };
}
