import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Result, Schema } from 'effect';
import { GO_MUSE, PAID_MUSE } from './models.js';

// The lead can pause every Go call until a date. The setting lives in config.json
// next to state.json and is read on every call, so it applies without a restart.
export function goPauseConfigPath(): string {
  const override = process.env['ZILAR_LEAD_CONFIG'];
  if (override !== undefined && override.length > 0) {
    return override;
  }
  return path.join(os.homedir(), '.zilar-lead', 'config.json');
}

const goPauseConfigSchema = Schema.Struct({
  goPausedUntil: Schema.optional(
    Schema.String.pipe(Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/))),
  ),
});

// A malformed file is reported once per config, then ignored: a typo must never stop
// the lead.
const warnedBadConfig = new Set<string>();

export function warnBadConfig(name: string, configPath: string, detail: string): void {
  if (warnedBadConfig.has(name)) {
    return;
  }
  warnedBadConfig.add(name);
  console.warn(`lead: ignoring bad ${name} config at ${configPath}: ${detail}`);
}

function validIsoDate(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

// The config file's JSON, or undefined when it is missing or not valid JSON.
export function readConfigJson(configPath: string, onBadJson: () => void): unknown {
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch {
    return undefined; // no file = not paused
  }
  try {
    return JSON.parse(raw);
  } catch {
    onBadJson();
    return undefined;
  }
}

// The ISO date Go stays paused until; paused strictly before it, back on the date.
export function goPause(
  now: Date = new Date(),
  configPath: string = goPauseConfigPath(),
): { until: string } | undefined {
  const parsed = readConfigJson(configPath, () =>
    warnBadConfig('go-pause', configPath, 'not valid JSON'),
  );
  if (parsed === undefined) {
    return undefined;
  }
  const decoded = Schema.decodeUnknownResult(goPauseConfigSchema)(parsed);
  if (Result.isFailure(decoded)) {
    warnBadConfig('go-pause', configPath, 'goPausedUntil must be an ISO date like 2026-10-26');
    return undefined;
  }
  const until = decoded.success.goPausedUntil;
  if (until === undefined) {
    return undefined;
  }
  if (!validIsoDate(until)) {
    warnBadConfig('go-pause', configPath, `goPausedUntil is not a real date: ${until}`);
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

// While Go is paused a pre-review or doctor skips Go listings for the metered Muse.
export function withoutPausedGoModel(model: ModelRef, goPaused: boolean): ModelRef {
  if (!goPaused || `${model.providerID}/${model.id}` !== GO_MUSE) {
    return model;
  }
  const slash = PAID_MUSE.indexOf('/');
  return { providerID: PAID_MUSE.slice(0, slash), id: PAID_MUSE.slice(slash + 1) };
}
