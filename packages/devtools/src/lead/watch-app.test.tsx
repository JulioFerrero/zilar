import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { render as inkRender } from 'ink';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { REFRESH_INTERVAL_MS, type WatchEntry, type WatchView } from './watch';
import { SPINNER_FRAMES, WATCH_ICONS, type WatchIconName } from './watch-format';
import { badgeSegs, speedSegs, WatchApp, WatchLive } from './watch-app';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

function entry(overrides: Partial<WatchEntry>): WatchEntry {
  return {
    id: 'T-0191',
    title: 'Mobile: sticker pack editor',
    modelLabel: 'muse-spark-1.3-contributor (low)',
    model: 'meta/muse-spark-1.3-contributor',
    effort: 'low',
    totalAge: '42 m',
    autoFixRounds: 0,
    phaseId: 'coding',
    phaseLabel: 'Coding',
    needsLead: false,
    running: true,
    step: 'editing sticker-pack.tsx',
    files: [],
    speed: null,
    ...overrides,
  };
}

function view(entries: WatchEntry[], mergedToday = 3): WatchView {
  return { clock: '11:33:52', refreshFailed: false, mergedToday, entries };
}

function manyEntries(count: number): WatchEntry[] {
  return Array.from({ length: count }, (_value, index) => entry({ id: `T-000${index + 1}` }));
}

function stripAnsi(frame: string): string {
  const esc = String.fromCharCode(27);
  return frame.replace(new RegExp(`${esc}\\[[0-9;]*[a-zA-Z]`, 'g'), '');
}

function linesOf(frame: string | undefined): string[] {
  expect(frame).toBeDefined();
  return stripAnsi(frame ?? '').split('\n');
}

function trackerLine(lines: string[], phaseText: string): string {
  const line = lines.find((candidate) => candidate.includes(phaseText));
  expect(line).toBeDefined();
  return line ?? '';
}

describe('WatchApp task cards', () => {
  it('renders a coding card with the first tracker step current', () => {
    const { lastFrame, unmount } = render(
      <WatchApp view={view([entry({})])} updatedAgoSecs={2} columns={100} />,
    );
    try {
      const lines = linesOf(lastFrame());
      const tracker = trackerLine(lines, 'Coding');
      expect(tracker).toContain('●');
      expect(tracker).toContain('○');
      expect(tracker.match(/●/g)).toHaveLength(1);
      expect(tracker.match(/○/g)).toHaveLength(3);
      expect(lines.some((line) => line.includes('T-0191'))).toBe(true);
      expect(lines.some((line) => line.includes('editing sticker-pack.tsx'))).toBe(true);
    } finally {
      unmount();
    }
  });

  it('renders a fixing card at step 2 with the round number', () => {
    const { lastFrame, unmount } = render(
      <WatchApp
        view={view([
          entry({
            phaseId: 'fixing',
            phaseLabel: 'Fixing',
            autoFixRounds: 2,
            totalAge: '1 h 5 min',
          }),
        ])}
        updatedAgoSecs={2}
        columns={100}
      />,
    );
    try {
      const lines = linesOf(lastFrame());
      const tracker = trackerLine(lines, 'Fixing');
      expect(tracker.match(/●/g)).toHaveLength(2);
      expect(tracker.match(/○/g)).toHaveLength(2);
      expect(tracker).toContain('round 2');
      expect(tracker).toContain('1 h 5 min');
    } finally {
      unmount();
    }
  });

  it('renders a pre-review card at step 3', () => {
    const { lastFrame, unmount } = render(
      <WatchApp
        view={view([
          entry({
            phaseId: 'prereview',
            phaseLabel: 'Pre-review running',
            running: true,
            step: null,
          }),
        ])}
        updatedAgoSecs={2}
        columns={100}
      />,
    );
    try {
      const lines = linesOf(lastFrame());
      const tracker = trackerLine(lines, 'Pre-review running');
      expect(tracker.match(/●/g)).toHaveLength(3);
      expect(tracker.match(/○/g)).toHaveLength(1);
    } finally {
      unmount();
    }
  });

  it('renders a waiting-for-lead card at step 4 with no live step line', () => {
    const { lastFrame, unmount } = render(
      <WatchApp
        view={view([
          entry({
            phaseId: 'waiting-lead',
            phaseLabel: 'Packet ready, waiting for the lead',
            needsLead: true,
            running: false,
            step: 'editing foo.ts',
          }),
        ])}
        updatedAgoSecs={2}
        columns={100}
      />,
    );
    try {
      const lines = linesOf(lastFrame());
      const tracker = trackerLine(lines, 'Packet ready');
      expect(tracker.match(/●/g)).toHaveLength(4);
      expect(tracker).not.toContain('○');
      expect(lines.some((line) => line.includes('editing foo.ts'))).toBe(false);
    } finally {
      unmount();
    }
  });
});

describe('WatchApp model badge', () => {
  it('shows Muse plus free for a free Muse model', () => {
    const { lastFrame, unmount } = render(
      <WatchApp
        view={view([entry({ model: 'meta/muse-spark-1.3-contributor-free', effort: 'low' })])}
        updatedAgoSecs={2}
        columns={100}
      />,
    );
    try {
      const frame = stripAnsi(lastFrame() ?? '');
      expect(frame).toContain('Muse · low free');
    } finally {
      unmount();
    }
  });

  it('shows MiniMax for a MiniMax model', () => {
    const { lastFrame, unmount } = render(
      <WatchApp
        view={view([entry({ model: 'minimax/MiniMax-M2.1', effort: 'medium' })])}
        updatedAgoSecs={2}
        columns={100}
      />,
    );
    try {
      const frame = stripAnsi(lastFrame() ?? '');
      expect(frame).toContain('MiniMax · medium');
    } finally {
      unmount();
    }
  });

  it('shows the bare model id for an unknown model', () => {
    const { lastFrame, unmount } = render(
      <WatchApp
        view={view([entry({ model: 'acme/some-model', effort: undefined })])}
        updatedAgoSecs={2}
        columns={100}
      />,
    );
    try {
      const frame = stripAnsi(lastFrame() ?? '');
      expect(frame).toContain('some-model');
      expect(frame).not.toContain('Muse');
      expect(frame).not.toContain('MiniMax');
    } finally {
      unmount();
    }
  });
});

describe('WatchApp header and footer', () => {
  it('shows working, needs-you and merged-today counters', () => {
    const { lastFrame, unmount } = render(
      <WatchApp
        view={view(
          [
            entry({ id: 'T-1' }),
            entry({
              id: 'T-2',
              phaseId: 'waiting-lead',
              phaseLabel: 'Packet ready, waiting for the lead',
              needsLead: true,
              running: false,
              step: null,
            }),
          ],
          3,
        )}
        updatedAgoSecs={2}
        columns={100}
      />,
    );
    try {
      const frame = stripAnsi(lastFrame() ?? '');
      expect(frame).toContain('zilar · lead');
      expect(frame).toContain('11:33:52');
      expect(frame).toContain('1 working');
      expect(frame).toContain('1 needs you');
      expect(frame).toContain('3 merged today');
      expect(frame).toContain(`q quit · ${WATCH_ICONS.branch.glyph} main · updated 2 s ago`);
    } finally {
      unmount();
    }
  });

  it('shows the empty state when no tasks are in flight', () => {
    const { lastFrame, unmount } = render(
      <WatchApp view={view([])} updatedAgoSecs={2} columns={100} />,
    );
    try {
      expect(stripAnsi(lastFrame() ?? '')).toContain('No tasks in flight.');
    } finally {
      unmount();
    }
  });

  it('shows the refresh failure in the footer', () => {
    const { lastFrame, unmount } = render(
      <WatchApp view={{ ...view([]), refreshFailed: true }} updatedAgoSecs={2} columns={100} />,
    );
    try {
      const frame = stripAnsi(lastFrame() ?? '');
      expect(frame).toContain('refresh failed, retrying');
    } finally {
      unmount();
    }
  });

  it('shows the speed line and file counts', () => {
    const { lastFrame, unmount } = render(
      <WatchApp
        view={view([
          entry({
            speed: { tokPerSec: 18.234, secPerStep: 9.612, context: 158_705, spark: [1, 2, 3] },
            files: [
              { path: 'packages/devtools/src/lead/watch.ts', kind: 'created' },
              { path: 'packages/devtools/src/lead/cli.ts', kind: 'modified' },
            ],
          }),
        ])}
        updatedAgoSecs={2}
        columns={100}
      />,
    );
    try {
      const frame = stripAnsi(lastFrame() ?? '');
      expect(frame).toContain('18.2 tok/s');
      expect(frame).toContain(`${WATCH_ICONS.context.glyph} 158k`);
      expect(frame).toContain(`${WATCH_ICONS.added.glyph} 1`);
      expect(frame).toContain(`${WATCH_ICONS.modified.glyph} 1`);
      expect(frame).toContain('watch.ts');
    } finally {
      unmount();
    }
  });

  it('shows measuring… when speed is null', () => {
    const { lastFrame, unmount } = render(
      <WatchApp view={view([entry({ speed: null })])} updatedAgoSecs={2} columns={100} />,
    );
    try {
      expect(stripAnsi(lastFrame() ?? '')).toContain('measuring…');
    } finally {
      unmount();
    }
  });
});

describe('WatchApp width', () => {
  function richView(): WatchView {
    return view([
      entry({
        title: 'A very long task title that must be cut to fit narrow terminals',
        model: 'meta/muse-spark-1.3-contributor-free',
        effort: 'low',
        phaseId: 'fixing',
        phaseLabel: 'Fixing review findings',
        autoFixRounds: 2,
        totalAge: '42 m',
        step: 'editing sticker-pack.tsx',
        speed: { tokPerSec: 18.234, secPerStep: 9.612, context: 158_705, spark: [1, 2, 3, 4] },
        files: [
          { path: 'apps/mobile/src/components/sticker-pack.tsx', kind: 'created' },
          { path: 'apps/mobile/src/lib/pack-editor.ts', kind: 'modified' },
        ],
      }),
    ]);
  }

  for (const width of [40, 60, 100]) {
    it(`fits every line within ${width} columns`, () => {
      const { lastFrame, unmount } = render(
        <WatchApp view={richView()} updatedAgoSecs={2} columns={width} />,
      );
      try {
        const lines = linesOf(lastFrame());
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
          expect(Array.from(line).length).toBeLessThanOrEqual(width);
        }
        const bordered = lines.filter((line) => /^[╭╰│]/.test(line));
        expect(bordered.length).toBeGreaterThan(0);
        for (const line of bordered) {
          expect(Array.from(line).length).toBe(width);
        }
      } finally {
        unmount();
      }
    });
  }

  it('uses the compact tracker below 50 columns', () => {
    const { lastFrame, unmount } = render(
      <WatchApp view={richView()} updatedAgoSecs={2} columns={40} />,
    );
    try {
      const lines = linesOf(lastFrame());
      const tracker = trackerLine(lines, 'Fixing');
      expect(tracker).not.toContain('━');
      expect(tracker).toContain('●');
      expect(tracker).toContain('○');
      const files = lines.find((line) => line.includes(WATCH_ICONS.added.glyph));
      expect(files).toBeDefined();
      expect(files).not.toContain('sticker-pack.tsx');
      expect(files).not.toContain('pack-editor.ts');
    } finally {
      unmount();
    }
  });

  it('keeps the tracker bars at 60 columns', () => {
    const { lastFrame, unmount } = render(
      <WatchApp view={richView()} updatedAgoSecs={2} columns={60} />,
    );
    try {
      const lines = linesOf(lastFrame());
      expect(trackerLine(lines, 'Fixing')).toContain('━');
    } finally {
      unmount();
    }
  });
});

function hasPrivateUse(text: string): boolean {
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    if (cp >= 0xe000 && cp <= 0xf8ff) {
      return true;
    }
    if (cp >= 0xf0000 && cp <= 0xffffd) {
      return true;
    }
  }
  return false;
}

describe('WatchApp icons', () => {
  it('shows Nerd Font glyphs in the header counters with icons on', () => {
    const { lastFrame, unmount } = render(
      <WatchApp view={view([entry({})])} updatedAgoSecs={2} columns={100} icons />,
    );
    try {
      const frame = stripAnsi(lastFrame() ?? '');
      expect(frame).toContain(WATCH_ICONS.working.glyph);
      expect(frame).toContain(WATCH_ICONS.needsYou.glyph);
      expect(frame).toContain(WATCH_ICONS.merged.glyph);
    } finally {
      unmount();
    }
  });

  it('renders no Private Use Area character with icons off', () => {
    const { lastFrame, unmount } = render(
      <WatchApp
        view={view([
          entry({
            step: 'editing sticker-pack.tsx',
            speed: { tokPerSec: 18.2, secPerStep: 9.6, context: 158_705, spark: [1, 2, 3] },
            files: [{ path: 'watch.ts', kind: 'created' }],
          }),
        ])}
        updatedAgoSecs={2}
        columns={100}
        icons={false}
      />,
    );
    try {
      const frame = stripAnsi(lastFrame() ?? '');
      expect(hasPrivateUse(frame)).toBe(false);
      expect(frame).toContain(`${WATCH_ICONS.working.fallback} 1 working`);
    } finally {
      unmount();
    }
  });
});

describe('WatchApp live step icon', () => {
  it.each([
    ['thinking', 'thinking'],
    ['reading watch.ts', 'reading'],
    ['editing sticker-pack.tsx', 'editing'],
    ['running tests', 'tests'],
    ['running the gate', 'gate'],
    ['committing', 'commit'],
  ])('shows the step icon for %s', (step, name) => {
    const icon = name as WatchIconName;
    const { lastFrame, unmount } = render(
      <WatchApp view={view([entry({ step })])} updatedAgoSecs={2} columns={100} icons />,
    );
    try {
      const frame = stripAnsi(lastFrame() ?? '');
      expect(frame).toContain(WATCH_ICONS[icon].glyph);
      expect(frame).toContain(step);
    } finally {
      unmount();
    }
  });

  it('shows no step icon for other steps', () => {
    const { lastFrame, unmount } = render(
      <WatchApp
        view={view([entry({ step: 'writing a reply' })])}
        updatedAgoSecs={2}
        columns={100}
        icons
      />,
    );
    try {
      const frame = stripAnsi(lastFrame() ?? '');
      expect(frame).toContain('writing a reply');
      const names: WatchIconName[] = ['thinking', 'reading', 'editing', 'tests', 'gate', 'commit'];
      for (const name of names) {
        expect(frame).not.toContain(WATCH_ICONS[name].glyph);
      }
    } finally {
      unmount();
    }
  });
});

describe('WatchApp header', () => {
  it('shows the brand icon before the title and the clock icon by the time', () => {
    const { lastFrame, unmount } = render(
      <WatchApp view={view([entry({})])} updatedAgoSecs={2} columns={100} icons />,
    );
    try {
      const frame = stripAnsi(lastFrame() ?? '');
      expect(frame).toContain(`${WATCH_ICONS.brand.glyph} zilar`);
      expect(frame).toContain(`${WATCH_ICONS.clock.glyph} 11:33:52`);
    } finally {
      unmount();
    }
  });

  it('falls back to plain markers with icons off', () => {
    const { lastFrame, unmount } = render(
      <WatchApp view={view([entry({})])} updatedAgoSecs={2} columns={100} icons={false} />,
    );
    try {
      const frame = stripAnsi(lastFrame() ?? '');
      expect(frame).toContain(`${WATCH_ICONS.brand.fallback} zilar`);
      expect(frame).toContain('11:33:52');
      expect(hasPrivateUse(frame)).toBe(false);
    } finally {
      unmount();
    }
  });
});

describe('WatchApp card top border', () => {
  it('shows the spinner before the id of a running card', () => {
    const { lastFrame, unmount } = render(
      <WatchApp view={view([entry({})])} updatedAgoSecs={2} columns={100} icons />,
    );
    try {
      const lines = linesOf(lastFrame());
      const top = lines.find((line) => line.includes('T-0191'));
      expect(top).toBeDefined();
      expect(top?.startsWith('╭')).toBe(true);
      expect(SPINNER_FRAMES.some((glyph) => top?.includes(glyph))).toBe(true);
    } finally {
      unmount();
    }
  });

  it('shows the bell before the id of a waiting-for-lead card', () => {
    const { lastFrame, unmount } = render(
      <WatchApp
        view={view([
          entry({ phaseId: 'waiting-lead', needsLead: true, running: false, step: null }),
        ])}
        updatedAgoSecs={2}
        columns={100}
        icons
      />,
    );
    try {
      const lines = linesOf(lastFrame());
      const top = lines.find((line) => line.includes('T-0191'));
      expect(top).toBeDefined();
      expect(top).toContain(WATCH_ICONS.needsYou.glyph);
    } finally {
      unmount();
    }
  });

  it('shows no marker before the id with icons off on a waiting card', () => {
    const { lastFrame, unmount } = render(
      <WatchApp
        view={view([
          entry({ phaseId: 'waiting-lead', needsLead: true, running: false, step: null }),
        ])}
        updatedAgoSecs={2}
        columns={100}
        icons={false}
      />,
    );
    try {
      const lines = linesOf(lastFrame());
      const top = lines.find((line) => line.includes('T-0191'));
      expect(top).toBeDefined();
      expect(hasPrivateUse(top ?? '')).toBe(false);
    } finally {
      unmount();
    }
  });
});

describe('WatchApp waiting card', () => {
  it('shows the review line and the idle line instead of live step and speed', () => {
    const { lastFrame, unmount } = render(
      <WatchApp
        view={view([
          entry({ phaseId: 'waiting-lead', needsLead: true, running: false, step: null }),
        ])}
        updatedAgoSecs={2}
        columns={100}
        icons
      />,
    );
    try {
      const frame = stripAnsi(lastFrame() ?? '');
      expect(frame).toContain('review the packet and merge');
      expect(frame).toContain(WATCH_ICONS.needsYou.glyph);
      expect(frame).toContain('waiting for you');
      expect(frame).toContain(WATCH_ICONS.idle.glyph);
      expect(frame).not.toContain('measuring');
    } finally {
      unmount();
    }
  });

  it('keeps the waiting text readable with icons off', () => {
    const { lastFrame, unmount } = render(
      <WatchApp
        view={view([
          entry({ phaseId: 'waiting-lead', needsLead: true, running: false, step: null }),
        ])}
        updatedAgoSecs={2}
        columns={100}
        icons={false}
      />,
    );
    try {
      const frame = stripAnsi(lastFrame() ?? '');
      expect(frame).toContain('review the packet and merge');
      expect(frame).toContain('waiting for you');
      expect(hasPrivateUse(frame)).toBe(false);
    } finally {
      unmount();
    }
  });
});

describe('WatchApp files line', () => {
  it('shows the three icons with counts and the names dimmed', () => {
    const { lastFrame, unmount } = render(
      <WatchApp
        view={view([
          entry({
            files: [
              { path: 'a/new.ts', kind: 'created' },
              { path: 'b/changed.ts', kind: 'modified' },
              { path: 'c/gone.ts', kind: 'deleted' },
            ],
          }),
        ])}
        updatedAgoSecs={2}
        columns={100}
        icons
      />,
    );
    try {
      const frame = stripAnsi(lastFrame() ?? '');
      expect(frame).toContain(`${WATCH_ICONS.added.glyph} 1`);
      expect(frame).toContain(`${WATCH_ICONS.modified.glyph} 1`);
      expect(frame).toContain(`${WATCH_ICONS.removed.glyph} 1`);
      expect(frame).toContain('new.ts');
      expect(frame).toContain('changed.ts');
    } finally {
      unmount();
    }
  });

  it('uses the plain fallbacks with icons off', () => {
    const { lastFrame, unmount } = render(
      <WatchApp
        view={view([
          entry({
            files: [
              { path: 'a/new.ts', kind: 'created' },
              { path: 'b/changed.ts', kind: 'modified' },
            ],
          }),
        ])}
        updatedAgoSecs={2}
        columns={100}
        icons={false}
      />,
    );
    try {
      const frame = stripAnsi(lastFrame() ?? '');
      expect(frame).toContain(`${WATCH_ICONS.added.fallback} 1`);
      expect(frame).toContain(`${WATCH_ICONS.modified.fallback} 1`);
      expect(hasPrivateUse(frame)).toBe(false);
    } finally {
      unmount();
    }
  });
});

describe('WatchApp footer', () => {
  it('shows the branch icon and main with icons on', () => {
    const { lastFrame, unmount } = render(
      <WatchApp view={view([])} updatedAgoSecs={5} columns={100} icons />,
    );
    try {
      const frame = stripAnsi(lastFrame() ?? '');
      expect(frame).toContain(`${WATCH_ICONS.branch.glyph} main`);
      expect(frame).toContain('updated 5 s ago');
    } finally {
      unmount();
    }
  });

  it('drops the branch icon with icons off', () => {
    const { lastFrame, unmount } = render(
      <WatchApp view={view([])} updatedAgoSecs={5} columns={100} icons={false} />,
    );
    try {
      const frame = stripAnsi(lastFrame() ?? '');
      expect(frame).toContain('q quit');
      expect(frame).toContain('main');
      expect(frame).toContain('updated 5 s ago');
      expect(hasPrivateUse(frame)).toBe(false);
    } finally {
      unmount();
    }
  });
});

describe('WatchApp speed line', () => {
  it.each([
    [42_000, '42k'],
    [163_000, '163k'],
    [250_000, '250k'],
  ])('shows the context value %s as %s', (context, text) => {
    const { lastFrame, unmount } = render(
      <WatchApp
        view={view([
          entry({ speed: { tokPerSec: 18.2, secPerStep: 9.6, context, spark: [1, 2, 3] } }),
        ])}
        updatedAgoSecs={2}
        columns={100}
        icons
      />,
    );
    try {
      const frame = stripAnsi(lastFrame() ?? '');
      expect(frame).toContain(`${WATCH_ICONS.context.glyph} ${text}`);
    } finally {
      unmount();
    }
  });

  it('shows ctx with icons off', () => {
    const { lastFrame, unmount } = render(
      <WatchApp
        view={view([
          entry({ speed: { tokPerSec: 18.2, secPerStep: 9.6, context: 42_000, spark: [] } }),
        ])}
        updatedAgoSecs={2}
        columns={100}
        icons={false}
      />,
    );
    try {
      expect(stripAnsi(lastFrame() ?? '')).toContain('ctx 42k');
    } finally {
      unmount();
    }
  });
});

describe('WatchApp speed colour', () => {
  const speed = { tokPerSec: 18.2, secPerStep: 9.6, context: 163_000, spark: [1, 2, 3] };

  it('renders tok/s in the phase colour', () => {
    expect(speedSegs(speed, false, 100, true, 'cyan')).toContainEqual({
      text: '18.2',
      color: 'cyan',
    });
    expect(speedSegs(speed, false, 100, true, 'magenta')).toContainEqual({
      text: '18.2',
      color: 'magenta',
    });
  });

  it('renders the context value in its threshold colour', () => {
    expect(speedSegs({ ...speed, context: 42_000 }, false, 100, true, 'cyan')).toContainEqual({
      text: '42k',
      color: 'green',
    });
    expect(speedSegs(speed, false, 100, true, 'cyan')).toContainEqual({
      text: '163k',
      color: 'yellow',
    });
    expect(speedSegs({ ...speed, context: 250_000 }, false, 100, true, 'cyan')).toContainEqual({
      text: '250k',
      color: 'red',
    });
  });

  it('renders the badge name in magenta with a green free tag', () => {
    const segs = badgeSegs({ name: 'Muse', effort: 'low', free: true, color: 'magenta' });
    expect(segs).toContainEqual({ text: 'Muse', color: 'magenta' });
    expect(segs).toContainEqual({ text: ' free', color: 'green' });
  });

  it('shows the coloured speed values in the card', () => {
    const { lastFrame, unmount } = render(
      <WatchApp
        view={view([entry({ phaseId: 'coding', speed })])}
        updatedAgoSecs={2}
        columns={100}
        icons
      />,
    );
    try {
      const frame = stripAnsi(lastFrame() ?? '');
      expect(frame).toContain('18.2 tok/s');
      expect(frame).toContain(`${WATCH_ICONS.context.glyph} 163k`);
    } finally {
      unmount();
    }
  });
});

describe('WatchLive refresh overlap guard', () => {
  type RefreshCallback = (error: Error | null, stdout: string, stderr: string) => void;

  // The fake clock already makes the timing exact. What load stretches is the
  // real CPU cost of the Ink re-renders driven by the ~20 one-second clock ticks
  // across the two 10 s advances: about 230 ms idle, over 5 s on a saturated
  // host, so the budget is wide.
  it(
    'skips a refresh while the previous child process is still running',
    { timeout: 60000 },
    async () => {
      vi.useFakeTimers();
      try {
        const mocked = vi.mocked(execFile);
        mocked.mockReset();
        mocked.mockImplementation((() => undefined) as unknown as typeof execFile);
        const { unmount } = render(<WatchLive initial={view([])} />);
        try {
          await vi.advanceTimersByTimeAsync(0);
          expect(mocked).toHaveBeenCalledTimes(1);
          await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);
          expect(mocked).toHaveBeenCalledTimes(1);
          const firstCall = mocked.mock.calls[0] as unknown[];
          const callback = firstCall[3] as RefreshCallback;
          callback(
            null,
            JSON.stringify({
              clock: '11:33:52',
              refreshFailed: false,
              mergedToday: 3,
              entries: [],
            }),
            '',
          );
          await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);
          expect(mocked).toHaveBeenCalledTimes(2);
        } finally {
          unmount();
        }
      } finally {
        vi.useRealTimers();
      }
    },
  );
});

describe('WatchLive without a TTY stdin', () => {
  it('renders without throwing when raw mode is not supported', () => {
    class FakeStdout extends EventEmitter {
      frames: string[] = [];
      columns = 100;
      write = (frame: string): boolean => {
        this.frames.push(frame);
        return true;
      };
    }
    class FakeStdin extends EventEmitter {
      isTTY = false;
      read = (): null => null;
    }
    const stdout = new FakeStdout();
    const stdin = new FakeStdin();
    const instance = inkRender(<WatchLive initial={view([])} />, {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      stdout: stdout as unknown as NodeJS.WritableStream,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      stdin: stdin as unknown as NodeJS.ReadableStream,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    try {
      expect(stdout.frames.length).toBeGreaterThan(0);
    } finally {
      instance.unmount();
    }
  });
});

describe('WatchApp scrolling', () => {
  it('shows only the cards that fit and a down-more hint in one column', () => {
    const { lastFrame, unmount } = render(
      <WatchApp view={view(manyEntries(9))} updatedAgoSecs={2} columns={64} rows={30} />,
    );
    try {
      const frame = stripAnsi(lastFrame() ?? '');
      expect(frame).toContain('↓ 5 more');
      expect(frame).toContain('q quit · ↑↓ scroll');
      expect(frame).toContain('T-0004');
      expect(frame).not.toContain('T-0005');
      expect(frame).not.toContain('T-0009');
    } finally {
      unmount();
    }
  });

  it('shows the last card and an up-more hint when scrolled to the end', () => {
    const { lastFrame, unmount } = render(
      <WatchApp
        view={view(manyEntries(9))}
        updatedAgoSecs={2}
        columns={64}
        rows={30}
        scroll={99}
      />,
    );
    try {
      const frame = stripAnsi(lastFrame() ?? '');
      expect(frame).toContain('↑ 8 more');
      expect(frame).toContain('T-0009');
      expect(frame).not.toContain('T-0001');
    } finally {
      unmount();
    }
  });

  for (const width of [100, 140]) {
    it(`fits every line within ${width} columns in two columns`, () => {
      const { lastFrame, unmount } = render(
        <WatchApp
          view={view([entry({ id: 'T-0001' }), entry({ id: 'T-0002' })])}
          updatedAgoSecs={2}
          columns={width}
          rows={40}
        />,
      );
      try {
        const lines = linesOf(lastFrame());
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
          expect(Array.from(line).length).toBeLessThanOrEqual(width);
        }
        const bordered = lines.filter((line) => /^[╭╰│]/.test(line));
        expect(bordered.length).toBeGreaterThan(0);
        for (const line of bordered) {
          expect(Array.from(line).length).toBe(width);
        }
      } finally {
        unmount();
      }
    });
  }

  it('places two cards side by side at 120 columns', () => {
    const { lastFrame, unmount } = render(
      <WatchApp
        view={view([entry({ id: 'T-0001' }), entry({ id: 'T-0002' })])}
        updatedAgoSecs={2}
        columns={120}
        rows={40}
      />,
    );
    try {
      const lines = linesOf(lastFrame());
      const both = lines.find((line) => line.includes('T-0001') && line.includes('T-0002'));
      expect(both).toBeDefined();
    } finally {
      unmount();
    }
  });
});

describe('WatchLive keys', () => {
  class FakeStdout extends EventEmitter {
    frames: string[] = [];
    columns = 64;
    rows = 30;
    isTTY = true;
    write = (frame: string): boolean => {
      this.frames.push(frame);
      return true;
    };
    lastFrame = (): string => stripAnsi(this.frames.at(-1) ?? '');
  }

  class FakeStdin extends EventEmitter {
    isTTY = true;
    private data: string | null = null;
    setEncoding(): void {}
    setRawMode(): void {}
    resume(): void {}
    pause(): void {}
    ref(): void {}
    unref(): void {}
    write = (data: string): void => {
      this.data = data;
      this.emit('readable');
      this.emit('data', data);
    };
    read = (): string | null => {
      const data = this.data;
      this.data = null;
      return data;
    };
  }

  it('moves the view down with j', async () => {
    const mocked = vi.mocked(execFile);
    mocked.mockReset();
    mocked.mockImplementation((() => undefined) as unknown as typeof execFile);
    const stdout = new FakeStdout();
    const stdin = new FakeStdin();
    const instance = inkRender(<WatchLive initial={view(manyEntries(9))} />, {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      stdout: stdout as unknown as NodeJS.WritableStream,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      stdin: stdin as unknown as NodeJS.ReadableStream,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
    });
    const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));
    try {
      await settle();
      expect(stdout.lastFrame()).toContain('T-0001');
      expect(stdout.lastFrame()).not.toContain('T-0005');
      stdin.write('j');
      await settle();
      const frame = stdout.lastFrame();
      expect(frame).toContain('↑ 1 more');
      expect(frame).toContain('T-0005');
      expect(frame).not.toContain('T-0001');
    } finally {
      instance.unmount();
    }
  });
});
