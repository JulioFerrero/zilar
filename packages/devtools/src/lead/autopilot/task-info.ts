import fs from 'node:fs';
import path from 'node:path';
import type { FindingCounts } from '../decide.js';
import { findTaskFile } from '../launch.js';
import { extractBlockedText, parseFrontMatter } from '../task-file.js';

// The first line carrying a verdict out of PREREVIEW.md, for the packet-ready
// escalation. Falls back when the reviewer skipped it.
export function extractVerdict(text: string): string {
  const line = text.split('\n').find((candidate) => /verdict/i.test(candidate));
  return line === undefined ? '(no verdict line)' : line.trim();
}

// The `Counts: must-fix=N, should-fix=N, nit=N, follow-up=N` line the pre-review
// prompt asks for. Undefined when the reviewer skipped it, so the lead reads
// the packet. Older reviews with only three numbers parse with followUp 0.
export function extractCounts(text: string): FindingCounts | undefined {
  const match =
    /counts:[\s*]*must-?fix\s*[=:]?\s*(\d+)\s*[,;]?\s*should-?fix\s*[=:]?\s*(\d+)\s*[,;]?\s*nits?\s*[=:]?\s*(\d+)(?:\s*[,;]?\s*follow-?ups?\s*[=:]?\s*(\d+))?/i.exec(
      text,
    );
  if (match === null) {
    return undefined;
  }
  return {
    mustFix: Number(match[1]),
    shouldFix: Number(match[2]),
    nit: Number(match[3]),
    followUp: match[4] === undefined ? 0 : Number(match[4]),
  };
}

export function readTaskInfo(
  worktree: string,
  task: string,
): { file: string; status: string; branch: string; blockedText: string } | null {
  let file: string;
  try {
    file = findTaskFile(worktree, task);
  } catch {
    return null;
  }
  let text: string;
  try {
    text = fs.readFileSync(path.join(worktree, 'work', file), 'utf8');
  } catch {
    return null;
  }
  const fields = parseFrontMatter(text);
  return {
    file,
    status: fields['status'] ?? 'unknown',
    branch: fields['branch'] ?? '',
    blockedText: extractBlockedText(text),
  };
}

export function prereviewInfo(worktree: string): {
  present: boolean;
  verdict: string;
  counts: FindingCounts | undefined;
} {
  const file = path.join(worktree, 'PREREVIEW.md');
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { present: false, verdict: '', counts: undefined };
  }
  return { present: true, verdict: extractVerdict(text), counts: extractCounts(text) };
}
