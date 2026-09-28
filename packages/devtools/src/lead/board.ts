// Pure BOARD.md edits for `lead merge`. The board has an Active table whose
// rows look like `| [T-0038](T-0038-lead-autopilot.md) | Title | status | … |`
// and a Done table whose rows look like `| [T-0038](file) | summary | date |`.

const ACTIVE_ROW = /^\|\s*\[([A-Z]+-\d+)\]\(([^)]+)\)\s*\|/;
const DONE_HEADING = /^##\s+Done\s*$/;

export interface MovedBoard {
  text: string;
  removedActive: boolean;
}

// Moves the task's row out of the Active table and appends it to the end of
// the Done table as `| [T-XXXX](file) | <summary> | <today> |`.
export function moveBoardRow(
  board: string,
  task: string,
  file: string,
  summary: string,
  today: string,
): MovedBoard {
  const lines = board.split('\n');
  let removedActive = false;
  const kept: string[] = [];
  for (const line of lines) {
    const match = ACTIVE_ROW.exec(line);
    if (match !== null && match[1] === task) {
      removedActive = true;
      continue;
    }
    kept.push(line);
  }
  if (!removedActive) {
    throw new Error(`board has no Active row for ${task}`);
  }
  const doneIndex = kept.findIndex((line) => DONE_HEADING.test(line));
  if (doneIndex === -1) {
    throw new Error('board has no Done section');
  }
  const row = `| [${task}](${file}) | ${summary} | ${today} |`;
  // Append at the end of the Done table: trailing blank lines stay last.
  let insertAt = kept.length;
  while (insertAt > doneIndex + 1 && kept[insertAt - 1]?.trim() === '') {
    insertAt -= 1;
  }
  kept.splice(insertAt, 0, row);
  return { text: kept.join('\n'), removedActive };
}
