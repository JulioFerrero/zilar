// Pure BOARD.md edits for `lead merge`: an Active table of `| [T-0038](file) | Title |
// status | … |` rows and a Done table of `| [T-0038](file) | summary | date |` rows.

const ACTIVE_ROW = /^\|\s*\[([A-Z]+-\d+)\]\(([^)]+)\)\s*\|/;
const DONE_HEADING = /^##\s+Done\s*$/;

export interface MovedBoard {
  text: string;
  removedActive: boolean;
}

// Moves the task's row out of Active and appends it to Done. A task launched from an
// uncommitted spec may have no Active row, so only a present row is removed.
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
