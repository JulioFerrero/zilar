// Tool and routine adapters for the action gateway, so policy, kill switch, audit and approval cards all apply.
// Scope is (AI, topic): a tool of another chat or AI is invisible (a plain summary, never a throw).
// `created_by` is the AI's owner: the gateway does not carry the human who asked.
import type { ActionAdapter } from '../actions/registry';
import {
  createAdapterState,
  toolApproveHostsAdapter,
  toolRevokeHostsAdapter,
  type BuildToolAdaptersDeps,
} from './adapter-support';
import {
  routineDeleteAdapter,
  routinePauseAdapter,
  routineScheduleAdapter,
} from './routine-adapters';
import {
  toolListAdapter,
  toolReadAdapter,
  toolRevertAdapter,
  toolRunAdapter,
  toolSaveAdapter,
} from './tool-adapters';

export type { BuildToolAdaptersDeps } from './adapter-support';
export {
  MAX_SAVE_MODEL_TEXT_CHARS,
  MAX_TOOL_POST_CHARS,
  TOOL_RUNS_PER_HOUR,
  TOOL_RUN_WINDOW_MS,
} from './adapter-support';
export { describeSchedule, formatNextRun } from './routine-adapters';
export { MAX_TOOL_INPUT_BYTES, type ApproveHostsBoundArgs } from './tool-arg-schemas';

// Builds the eight tool/routine adapters to register next to the demo adapter.
// `tool.approve_hosts` (tier 2) and `tool.revoke_hosts` (tier 1) manage the approved host set.
export function buildToolAdapters(deps: BuildToolAdaptersDeps): ActionAdapter<unknown>[] {
  const state = createAdapterState(deps);
  const adapters: ActionAdapter<unknown>[] = [
    toolListAdapter(state),
    toolReadAdapter(state),
    toolSaveAdapter(state),
    toolRunAdapter(state),
    toolRevertAdapter(state),
    toolApproveHostsAdapter(state),
    toolRevokeHostsAdapter(state),
    routinePauseAdapter(state),
    routineDeleteAdapter(state),
  ];
  if (deps.routinesEnabled !== false) {
    adapters.push(routineScheduleAdapter(state));
  }
  return adapters;
}
