import { describe, expect, it } from 'vitest';
import { moveBoardRow } from './board';

// A small fixture in the real board's shape: an Active table and a Done table.
const BOARD = `# Board

## Active (M1 complete; next: M2 AIs that talk)

| ID | Title | Status | Model | Depends on | Notes |
|---|---|---|---|---|---|
| [T-0034](T-0034-ai-replies-dm.md) | Gateway | paused | muse | T-0033 | Notes here |
| [T-0038](T-0038-lead-autopilot.md) | Autopilot | todo | muse | — | Cuts usage |

## Follow-ups

- Something else.

## Done

| ID | Title | Merged |
|---|---|---|
| [T-0033](T-0033-ai-models-litellm.md) | Models | 2026-09-28 |
`;

describe('moveBoardRow', () => {
  it('moves the active row to the end of Done', () => {
    const moved = moveBoardRow(
      BOARD,
      'T-0038',
      'T-0038-lead-autopilot.md',
      'Autopilot tooling',
      '2026-09-29',
    );
    expect(moved.removedActive).toBe(true);
    expect(moved.text).not.toContain('[T-0038](T-0038-lead-autopilot.md) | Autopilot | todo');
    expect(moved.text).toContain(
      '| [T-0038](T-0038-lead-autopilot.md) | Autopilot tooling | 2026-09-29 |',
    );
    // The Done table keeps its old rows, with the new one last.
    const doneSection = moved.text.split('## Done')[1] as string;
    expect(doneSection.indexOf('T-0033')).toBeLessThan(doneSection.indexOf('T-0038'));
    // The other Active row is untouched.
    expect(moved.text).toContain('[T-0034](T-0034-ai-replies-dm.md)');
  });

  it('throws when the task has no Active row', () => {
    expect(() => moveBoardRow(BOARD, 'T-0099', 'T-0099-x.md', 'x', '2026-09-29')).toThrow(
      /no Active row/,
    );
  });

  it('throws when there is no Done section', () => {
    expect(() =>
      moveBoardRow('# Board\n\n| [T-0038](f.md) | t | s |\n', 'T-0038', 'f.md', 'x', '2026-09-29'),
    ).toThrow(/no Done section/);
  });
});
