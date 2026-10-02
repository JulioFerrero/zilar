import { describe, expect, it } from 'vitest';

import {
  evaluateWatch,
  findFailureReason,
  isFirstRenderLine,
  isBundleLoadedLine,
  logLineTimestampMs,
  stripAnsi,
} from './log-watch';

const ESC = String.fromCharCode(27);

describe('findFailureReason', () => {
  it('catches the real T-0026 crash line: Uncaught Error: Cannot find native module', () => {
    const line = "Uncaught Error: Cannot find native module 'ExpoSecureStore'";
    expect(findFailureReason(line)).toMatch(/Cannot find native module/);
  });

  it('catches the real T-0026 Metro line: Unable to resolve a module', () => {
    const line = 'error: Unable to resolve "better-auth/client/plugins" from "src/lib/auth.ts"';
    expect(findFailureReason(line)).toMatch(/Unable to resolve/);
  });

  it('catches a red-box ERROR line', () => {
    expect(findFailureReason(' ERROR  ReferenceError: property is not defined')).toMatch(/red box/);
  });

  it('catches an Invariant Violation', () => {
    expect(findFailureReason('Invariant Violation: require(...) expected map')).toMatch(
      /Invariant Violation/,
    );
  });

  it('catches a bundle that failed to build', () => {
    expect(findFailureReason('iOS Bundling failed (index.js)')).toMatch(/failed to build/);
  });

  it('sees through ANSI colour codes', () => {
    expect(findFailureReason(`${ESC}[31mERROR${ESC}[39m something broke`)).toMatch(/red box/);
    expect(stripAnsi(`${ESC}[31mERROR${ESC}[39m`)).toBe('ERROR');
  });

  it('ignores platform noise that merely contains ERROR, like a socket SO_ERROR (seen in the real app log)', () => {
    const line =
      '2026-09-28 11:50:59.957 E  Zilar[23488:444373] [com.apple.network:connection] nw_socket_handle_socket_event [C5.1.1:1] Socket SO_ERROR [61: Connection refused]';
    expect(findFailureReason(line)).toBeNull();
  });

  it('returns null for benign lines', () => {
    expect(findFailureReason('iOS Bundled 156ms (.expo/.virtual-metro-entry)')).toBeNull();
    expect(findFailureReason(' LOG  Rendered 120 frames in 34ms')).toBeNull();
    expect(findFailureReason('2026-09-28 10:00:00.123 localhost Zilar[42] Booted')).toBeNull();
  });
});

describe('isBundleLoadedLine', () => {
  it("detects Metro's Bundled line", () => {
    expect(isBundleLoadedLine(' iOS Bundled 156ms (.expo/.virtual-metro-entry)')).toBe(true);
    expect(isBundleLoadedLine(`${ESC}[1m iOS Bundled 156ms${ESC}[22m`)).toBe(true);
  });

  it('does not fire while bundling or when bundling failed', () => {
    expect(isBundleLoadedLine(' iOS Bundling http://localhost:8082/index.bundle')).toBe(false);
    expect(isBundleLoadedLine('iOS Bundling failed (index.js)')).toBe(false);
  });
});

describe('isFirstRenderLine', () => {
  it("detects the real 'Running main' line the app logged on this machine", () => {
    const line =
      '2026-09-28 11:51:00.328 I  Zilar[23488:444388] [com.facebook.react.log:javascript] Running "main" with {"rootTag":11,"initialProps":{},"fabric":true}';
    expect(isFirstRenderLine(line)).toBe(true);
  });

  it('ignores module-init and other app-log lines', () => {
    expect(
      isFirstRenderLine(
        "2026-09-28 11:51:00.583 I  Zilar[23488:444388] [dev.expo.modules:expo] Creating JS object for module 'ExpoSecureStore'",
      ),
    ).toBe(false);
    expect(isFirstRenderLine('iOS Bundled 13971ms ... (4092 modules)')).toBe(false);
  });
});

describe('logLineTimestampMs', () => {
  it('parses the leading timestamp of a compact log-show line', () => {
    const ms = logLineTimestampMs('2026-09-28 11:51:00.328 I  Zilar[23488:444388] hello');
    expect(ms).toBe(new Date('2026-09-28T11:51:00.328').getTime());
  });

  it('returns null for lines without a timestamp', () => {
    expect(logLineTimestampMs('log show failed: something')).toBeNull();
    expect(logLineTimestampMs('')).toBeNull();
  });
});

describe('evaluateWatch', () => {
  it('stays pending before the bundle loads', () => {
    expect(evaluateWatch({ metroLog: 'Waiting on http://localhost:8082\n', appLog: '' })).toEqual({
      status: 'pending',
    });
  });

  it('is bundled once Metro reports the bundle', () => {
    expect(
      evaluateWatch({
        metroLog: 'iOS Bundled 156ms (.expo/.virtual-metro-entry)\n',
        appLog: '',
      }),
    ).toEqual({ status: 'bundled' });
  });

  it('a failure after a successful bundle still fails the boot', () => {
    expect(
      evaluateWatch({
        metroLog: 'iOS Bundled 156ms (.expo/.virtual-metro-entry)\n',
        appLog: "Uncaught Error: Cannot find native module 'ExpoSecureStore'\n",
      }),
    ).toEqual({ status: 'failed', reason: 'the app reported "Cannot find native module"' });
  });

  it('fails when the app process exited and nothing else explains it', () => {
    expect(
      evaluateWatch({
        metroLog: 'iOS Bundled 156ms\n',
        appLog: '',
        appExited: true,
      }),
    ).toEqual({ status: 'failed', reason: 'the app process exited' });
  });
});
