// Added comment lines that cite a task ID: the task file and the commit already
// carry that history. Pure: the caller passes `git diff -U0 <base> -- apps packages`.

import { isSizeChecked } from './size.js';

const TASK_ID = /\bT-\d{3,4}\b/;
const COMMENT_PREFIXES: readonly string[] = ['//', '/*', '*', '{/*'];

function isComment(line: string): boolean {
  return COMMENT_PREFIXES.some((prefix) => line.startsWith(prefix));
}

export function taskIdComments(diff: string): string[] {
  const hits: string[] = [];
  let file: string | null = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      file = null;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const header = line.slice(4);
      file = header === '/dev/null' ? null : header.replace(/^b\//, '');
      continue;
    }
    if (file === null || !line.startsWith('+')) continue;
    const text = line.slice(1).trim();
    if (text.length === 0 || !isComment(text) || !TASK_ID.test(text)) continue;
    if (!isSizeChecked(file)) continue;
    hits.push(`${file}: ${text}`);
  }
  return hits;
}
