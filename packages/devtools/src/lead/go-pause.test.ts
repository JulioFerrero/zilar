import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fallbackModel } from './fallback.js';
import { goPause, isGoPaused, withoutPausedGoModel } from './go-pause.js';
import {
  DEEPSEEK_FLASH,
  FREE_DEEPSEEK_FLASH,
  FREE_GLM_FLASH,
  FREE_MUSE,
  GO_DEEPSEEK_FLASH,
  GO_MUSE,
  PAID_MUSE,
} from './models.js';
import { resolveWorkerModel } from './model-schedule.js';

const UNTIL = '2026-10-26';
const BEFORE = new Date('2026-10-25T12:00:00Z');
const ON = new Date('2026-10-26T00:00:00Z');
const AFTER = new Date('2026-11-02T09:00:00Z');

function writeConfig(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-go-pause-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, contents);
  return file;
}

describe('goPause', () => {
  it('pauses before the date and not on or after it', () => {
    const file = writeConfig(`{ "goPausedUntil": "${UNTIL}" }`);
    expect(goPause(BEFORE, file)).toEqual({ until: UNTIL });
    expect(isGoPaused(BEFORE, file)).toBe(true);
    expect(isGoPaused(ON, file)).toBe(false);
    expect(isGoPaused(AFTER, file)).toBe(false);
  });

  it('is not paused without a config file', () => {
    expect(isGoPaused(BEFORE, path.join(os.tmpdir(), 'no-such-go-pause.json'))).toBe(false);
  });

  it('ignores a bad file and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const file = writeConfig('{ "goPausedUntil": "not-a-date" }');
    expect(isGoPaused(BEFORE, file)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('while Go is paused', () => {
  it('still starts an auto worker on the free DeepSeek Flash (T-1718)', () => {
    const file = writeConfig(`{ "goPausedUntil": "${UNTIL}" }`);
    const goPaused = isGoPaused(BEFORE, file);
    expect(resolveWorkerModel('auto', BEFORE, goPaused)).toEqual({
      model: FREE_DEEPSEEK_FLASH,
      effortOverride: 'default',
    });
  });

  it('never falls back to a Go model', () => {
    for (const model of [
      FREE_DEEPSEEK_FLASH,
      GO_DEEPSEEK_FLASH,
      DEEPSEEK_FLASH,
      FREE_MUSE,
      FREE_GLM_FLASH,
      GO_MUSE,
      PAID_MUSE,
    ]) {
      const next = fallbackModel(model, true);
      expect(next === undefined || !next.startsWith('opencode-go/')).toBe(true);
    }
    expect(fallbackModel(FREE_DEEPSEEK_FLASH, true)).toBe(DEEPSEEK_FLASH);
    expect(fallbackModel(GO_DEEPSEEK_FLASH, true)).toBe(DEEPSEEK_FLASH);
    expect(fallbackModel(DEEPSEEK_FLASH, true)).toBe(PAID_MUSE);
    expect(fallbackModel(FREE_MUSE, true)).toBe(FREE_GLM_FLASH);
    expect(fallbackModel(FREE_GLM_FLASH, true)).toBe(PAID_MUSE);
  });

  it('moves a Go Muse pre-review or doctor to the paid Muse', () => {
    expect(
      withoutPausedGoModel({ providerID: 'opencode-go', id: 'muse-spark-1.3-contributor' }, true),
    ).toEqual({ providerID: 'meta', id: 'muse-spark-1.3-contributor' });
    expect(
      withoutPausedGoModel({ providerID: 'opencode', id: 'muse-spark-1.3-contributor-free' }, true),
    ).toEqual({ providerID: 'opencode', id: 'muse-spark-1.3-contributor-free' });
  });
});
