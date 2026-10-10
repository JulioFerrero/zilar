// Changed-file parsing for `lead watch`, moved unchanged from `lead/watch.ts`
// (size split).

export type FileKind = 'created' | 'modified' | 'deleted';

export interface ChangedFile {
  path: string;
  kind: FileKind;
}

// `--name-status` lines look like `M\tpath` or `R<score>\told\tnew`. `git
// status --porcelain` untracked lines look like `?? path`. Both are joined
// into one list, deduplicated, and ordered created → modified → deleted,
// each sorted alphabetically. Paths under `work/` are dropped.
export function parseChangedFiles(nameStatus: string, porcelain: string): ChangedFile[] {
  const created = new Set<string>();
  const modified = new Set<string>();
  const deleted = new Set<string>();
  for (const raw of nameStatus.split('\n')) {
    const line = raw.trim();
    if (line === '') {
      continue;
    }
    const parts = line.split('\t');
    const status = parts[0];
    if (status === undefined || parts.length < 2) {
      continue;
    }
    if (status.startsWith('A')) {
      addIfReal(created, parts[1]);
    } else if (status.startsWith('M')) {
      addIfReal(modified, parts[1]);
    } else if (status.startsWith('D')) {
      addIfReal(deleted, parts[1]);
    } else if (status.startsWith('R')) {
      // A rename shows up as a delete of the old name and a create of the new.
      const oldPath = parts[1];
      const newPath = parts[2];
      if (oldPath !== undefined) {
        addIfReal(deleted, oldPath);
      }
      if (newPath !== undefined) {
        addIfReal(created, newPath);
      }
    }
  }
  for (const raw of porcelain.split('\n')) {
    const line = raw.trim();
    if (line === '' || !line.startsWith('?? ')) {
      continue;
    }
    addIfReal(created, line.slice(3));
  }
  const sortAlpha = (a: string, b: string): number => a.localeCompare(b);
  const out: ChangedFile[] = [];
  for (const file of [...created].sort(sortAlpha)) {
    out.push({ path: file, kind: 'created' });
  }
  for (const file of [...modified].sort(sortAlpha)) {
    out.push({ path: file, kind: 'modified' });
  }
  for (const file of [...deleted].sort(sortAlpha)) {
    out.push({ path: file, kind: 'deleted' });
  }
  return out;
}

function addIfReal(set: Set<string>, candidate: string | undefined): void {
  if (candidate === undefined) {
    return;
  }
  if (candidate.startsWith('work/')) {
    return;
  }
  set.add(candidate);
}
