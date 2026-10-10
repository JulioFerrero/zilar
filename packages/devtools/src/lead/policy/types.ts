export type Verdict = 'allow' | 'reject' | 'escalate';

export interface Classification {
  verdict: Verdict;
  // Present on every rejection: the worker reads it and adapts.
  message?: string | undefined;
}

export interface PermissionRequest {
  id: string;
  action: string;
  // One entry per element of the request's `resources`. OpenCode splits a
  // piped command into one pattern per pipeline segment
  // (e.g. ["npx expo run:ios --help", "grep -iE \"port|device\"", "head"]),
  // so every element is classified on its own and the worst verdict wins.
  commands: string[];
}

export interface PolicyContext {
  // Absolute path of the requesting worker's own worktree.
  worktree: string;
  // Absolute path of the task id, e.g. "T-0038", used to recognize own temp files.
  task: string;
}

// Julio's simulators. Commands touching these UDIDs are always rejected:
// the lead runs its own live checks there and Julio uses them.
export const JULIO_SIMULATOR_UDIDS = [
  'A3E0C081-CEA4-453B-ABA1-23EE7D044E54',
  'DB167CD4-BDCE-4E04-BC5E-85EE868A6AD8',
];

// Only the shell tool's permission requests are classified by command. Any
// other action (including `bash`, which never matches a rule) escalates:
// when unsure, escalate, never allow by default.
export const SHELL_ACTION = 'shell';

export interface Rule {
  test: (segment: string, ctx: PolicyContext) => boolean;
  verdict: Verdict;
  message?: string;
}
