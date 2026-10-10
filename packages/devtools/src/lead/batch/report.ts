import type { Failure, TaskOutcome } from './types.js';

function countKinds(outcome: TaskOutcome): Record<Failure['kind'], number> {
  const counts: Record<Failure['kind'], number> = {
    typecheck: 0,
    lint: 0,
    format: 0,
    test: 0,
    tool: 0,
  };
  for (const failure of outcome.failures) {
    counts[failure.kind] += 1;
  }
  return counts;
}

export function taskIssues(outcome: TaskOutcome): number {
  const counts = countKinds(outcome);
  const failures = counts.typecheck + counts.lint + counts.format + counts.test + counts.tool;
  return failures + outcome.outside.length + (outcome.merged ? 0 : 1);
}

export function summaryLine(outcome: TaskOutcome): string {
  if (!outcome.merged) {
    return `${outcome.task} CONFLICT ${outcome.conflictFiles.join(', ') || '(merge failed)'}`;
  }
  const { typecheck, test: tests, lint, format } = countKinds(outcome);
  if (typecheck + tests + lint + format + outcome.outside.length === 0) {
    return `${outcome.task} ok`;
  }
  const lintPart = lint === 0 ? '' : `, lint ${lint}`;
  const formatPart = format === 0 ? '' : `, format ${format}`;
  return `${outcome.task} FAIL typecheck ${typecheck}, tests ${tests}${lintPart}${formatPart}, out of scope ${outcome.outside.length}`;
}

function failureItem(failure: Failure): string {
  const head =
    failure.kind === 'typecheck'
      ? `Typecheck error ${failure.name}`
      : failure.kind === 'lint'
        ? `Lint error ${failure.name} in ${failure.file ?? '(unknown file)'}`
        : failure.kind === 'format'
          ? `Prettier: ${failure.file ?? '(unknown file)'} is not formatted`
          : failure.kind === 'test'
            ? `Failing test in ${failure.file ?? '(unknown file)'}: ${failure.name}`
            : `Check failed: ${failure.name}${failure.file === undefined ? '' : ` (${failure.file})`}`;
  return `${head}\n\n\`\`\`\n${failure.message}\n\`\`\``;
}

export function fixFile(outcome: TaskOutcome, stampText: string): string {
  const items: string[] = [];
  if (!outcome.merged) {
    items.push(
      `Merge conflict: your branch ${outcome.branch} does not merge with the wave on ${outcome.conflictFiles.join(', ') || '(unknown files)'}. Rebase on main (and on the other tasks of the wave if told), keep both sides, \`git add\` each file, continue the rebase.`,
    );
  }
  for (const file of outcome.outside) {
    items.push(
      `Out of scope: \`${file}\` is outside this task's Allowed files. Revert it, or explain in the Report why it is needed.`,
    );
  }
  for (const failure of outcome.failures) {
    items.push(failureItem(failure));
  }
  return [
    `# ${outcome.task}: fixes from the combined check of wave ${stampText}`,
    '',
    'The branches of the wave were combined and checked together. Fix each item below, one commit per item, run `pnpm gate`, keep `status: review`.',
    '',
    ...items.map((item, index) => `${index + 1}. ${item}`),
    '',
  ].join('\n');
}

export function reportText(
  outcomes: TaskOutcome[],
  unowned: Failure[],
  stampText: string,
  ok: boolean,
): string {
  const rows = outcomes.map((outcome) => {
    const merge = outcome.merged
      ? 'merged'
      : `conflict: ${outcome.conflictFiles.join(', ') || 'merge failed'}`;
    const outside = outcome.outside.length === 0 ? '-' : outcome.outside.join(', ');
    const { typecheck, test: tests, lint } = countKinds(outcome);
    return `| ${outcome.task} | ${merge} | ${outside} | ${typecheck} | ${tests} | ${lint} |`;
  });
  const unownedItems =
    unowned.length === 0
      ? ['None.']
      : unowned.map((failure, index) => `${index + 1}. ${failureItem(failure)}`);
  return [
    `# Wave ${stampText}: ${ok ? 'OK' : 'NOT OK'}`,
    '',
    '| Task | Merge | Out of scope | Typecheck errors | Failed tests | Lint errors |',
    '|---|---|---|---|---|---|',
    ...rows,
    '',
    '## unowned',
    '',
    ...unownedItems,
    '',
  ].join('\n');
}
