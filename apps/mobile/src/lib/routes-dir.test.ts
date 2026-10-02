import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Expo Router turns every file in `src/app` into a route and bundles it into the app. A test file there
// pulls vitest (and with it vite) into the Metro bundle, and the app then fails to boot on the device.
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

describe('the route folder', () => {
  it('holds no test files', () => {
    const tests = filesUnder(join(__dirname, '..', 'app')).filter((file) =>
      /\.test\.tsx?$/.test(file),
    );
    expect(tests).toEqual([]);
  });
});
