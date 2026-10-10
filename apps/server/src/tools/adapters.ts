// T-0105: tool and routine adapters for the action gateway. The AI uses
// the versioned tools store (T-0103) and the routines scheduler (T-0104)
// only through these adapters, so the gateway's policy (the AI's id and
// chat come from the session), kill switch, audit log and approval cards
// all apply with no new special cases.
//
// Scope is (AI, topic): every lookup is within `ctx.aiId` + `ctx.topicId`,
// and `tool.run` and routine posts go into that topic's room. A tool of
// another chat or AI is invisible (a plain summary, never a throw).
//
// `created_by` for tools and routines is the AI's owner: the gateway does
// not carry the human who asked yet, so the owner is the only stable
// attribution available.
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

// Builds the eight tool/routine adapters. The caller registers them in the
// action registry next to (not instead of) the demo adapter.
//
// T-0132 adds two more: `tool.approve_hosts` (tier 2, a card in the topic
// showing the tool's CURRENT hosts read from the DB) and
// `tool.revoke_hosts` (tier 1, empties the approved set). The sandbox may
// only contact declared hosts ∩ approved hosts for every run trigger,
// because every run goes through `runToolVersion`.
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
