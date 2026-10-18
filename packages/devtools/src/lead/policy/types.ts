export type Verdict = 'allow' | 'reject' | 'escalate';

export interface Classification {
  verdict: Verdict;
  // Present on every rejection: the worker reads it and adapts.
  message?: string | undefined;
}

export interface PermissionRequest {
  id: string;
  action: string;
  // One entry per element of `resources`: OpenCode splits a piped command into one
  // pattern per segment, each classified on its own.
  commands: string[];
}

export interface PolicyContext {
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

// Only the shell tool's requests are classified by command; any other action escalates.
export const SHELL_ACTION = 'shell';

export interface Rule {
  test: (segment: string, ctx: PolicyContext) => boolean;
  verdict: Verdict;
  message?: string;
}
