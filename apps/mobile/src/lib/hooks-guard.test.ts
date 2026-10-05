import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { hooksAfterMarker } from './hooks-guard';

const HERE = dirname(fileURLToPath(import.meta.url));

const BEFORE = `function Chat() {
  const chat = null as unknown;
  useEffect(() => {}, []);
  if (!chat) {
    return null;
  }
  useEffect(() => {}, []);
}`;

const AFTER = `function Chat() {
  const chat = null as unknown;
  useEffect(() => {}, []);
  const redirect = chat === null ? undefined : 'g1';
  useEffect(() => {}, [redirect]);
  if (!chat) {
    return null;
  }
}`;

describe('hooksAfterMarker', () => {
  it('finds a hook after the early return (the pre-fix shape)', () => {
    expect(hooksAfterMarker(BEFORE, 'if (!chat) {')).toEqual(['useEffect(']);
  });

  it('passes for the fixed shape with every hook above the return', () => {
    expect(hooksAfterMarker(AFTER, 'if (!chat) {')).toEqual([]);
  });

  it('reports a missing marker instead of passing silently', () => {
    expect(hooksAfterMarker(AFTER, 'if (!nope) {')).toHaveLength(1);
  });

  it('checks the real screens, not just inline strings', () => {
    // T-0112 should-fix: the guard used to check inline strings only. The
    // real `chat/[id].tsx` keeps its redirect effect above the `!chat`
    // early return (every hook runs on every render), and the group screen
    // returns null only after all its hooks.
    const chatScreen = readFileSync(join(HERE, '..', 'app', 'chat', '[id].tsx'), 'utf8');
    expect(hooksAfterMarker(chatScreen, 'if (!chat) {')).toEqual([]);
    const groupScreen = readFileSync(join(HERE, '..', 'app', 'group', '[id].tsx'), 'utf8');
    expect(hooksAfterMarker(groupScreen, 'if (topics.length === 0')).toEqual([]);
  });

  it('remounts the new-topic sheet on every open, so it keeps no previous name', () => {
    // T-0112 should-fix: the sheet kept the previous name because its state
    // survived across opens. The screen remounts it per open via a key, so
    // React re-runs the initial `useState` values each time.
    const groupScreen = readFileSync(join(HERE, '..', 'app', 'group', '[id].tsx'), 'utf8');
    expect(groupScreen).toContain(`key={composerOpen ? 'open' : 'closed'}`);
  });

  it('maps the first roles load through describeRolesError load (T-0157)', () => {
    // T-0140/T-0147 should-fix: the mount load once used a hardcoded generic
    // line, so a 404 never read as gone. The screen's mount effect maps
    // through `describeRolesError(error, 'load')`; the mounted render test
    // (`group-roles-mounted.test.tsx`) pins the rendered line and Retry.
    const groupScreen = readFileSync(join(HERE, '..', 'app', 'group', '[id].tsx'), 'utf8');
    expect(groupScreen).toContain("setRolesLoadError(describeRolesError(error, 'load'))");
  });
});
