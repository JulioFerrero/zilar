// T-0107: tools and routines read model + mutations for the web UI.
// The wire contract lives in packages/api-contract (`tools.ts`, `routines.ts`,
// T-0893) and is implemented by apps/server/src/tools/api.ts and
// apps/server/src/routines/api.ts. Dates arrive as ISO strings and stay
// strings, like the approvals and audit schemas in api.ts.

import { callApi } from '@/lib/effect/api-client';
import type {
  Routine,
  ToolDetail,
  ToolListItem,
  ToolRun,
  ToolRunResult,
  ToolVersion,
  ToolVersionDetail,
} from '@zilar/api-contract';

export type { Routine, ToolDetail, ToolListItem, ToolRun, ToolRunResult, ToolVersion };
export type { ToolVersionDetail };

// --- Tools ---------------------------------------------------------------

/** Tools of one topic (anyone who can see the topic reads; else 404). */
export async function listTopicToolDetails(topicId: string): Promise<ToolListItem[]> {
  const rows = await callApi((client) => client.tools.listForTopic({ params: { id: topicId } }));
  return [...rows];
}

/** Tools of one group (any member; only topics the viewer can see). */
export async function listGroupToolDetails(groupId: string): Promise<ToolListItem[]> {
  const rows = await callApi((client) => client.tools.listForGroup({ params: { id: groupId } }));
  return [...rows];
}

/** Tools of one AI (the AI owner; with scope). */
export async function listAiToolDetails(aiId: string): Promise<ToolListItem[]> {
  const rows = await callApi((client) => client.tools.listForAi({ params: { id: aiId } }));
  return [...rows];
}

/** One tool with its current source. */
export function getToolDetail(id: string): Promise<ToolDetail> {
  return callApi((client) => client.tools.detail({ params: { id } }));
}

/** Version history of one tool, newest first, without source. */
export async function listToolVersions(id: string): Promise<ToolVersion[]> {
  const rows = await callApi((client) => client.tools.versions({ params: { id } }));
  return [...rows];
}

/** One version with its source. */
export function getToolVersion(id: string, version: number): Promise<ToolVersionDetail> {
  return callApi((client) => client.tools.version({ params: { id, n: String(version) } }));
}

/** Recent runs of one tool, newest first (never another chat's output: the server decides). */
export async function listToolRuns(id: string): Promise<ToolRun[]> {
  const rows = await callApi((client) => client.tools.runs({ params: { id } }));
  return [...rows];
}

/** Append a new version copying an older version's source and hosts. */
export function revertTool(id: string, version: number): Promise<ToolVersion> {
  return callApi((client) => client.tools.revert({ params: { id }, payload: { version } }));
}

/**
 * Run the current version now. `input` must serialise to at most 16 KiB
 * (the server answers 400 `invalid_request` above that, like the adapter).
 * Manager only; the server answers 404 for a viewer who may not run it.
 */
export function runToolNow(id: string, input?: unknown): Promise<ToolRunResult> {
  return callApi((client) =>
    client.tools.run({ params: { id }, payload: input === undefined ? {} : { input } }),
  );
}

export async function deleteTool(id: string): Promise<void> {
  await callApi((client) => client.tools.remove({ params: { id } }));
}

// --- Routines ------------------------------------------------------------

/** Routines of one AI (the AI owner; every topic, with scope). */
export async function listAiRoutines(aiId: string): Promise<Routine[]> {
  const rows = await callApi((client) => client.routines.listForAi({ params: { id: aiId } }));
  return [...rows];
}

/** Routines of one group (any member; only topics the viewer can see). */
export async function listGroupRoutines(groupId: string): Promise<Routine[]> {
  const rows = await callApi((client) => client.routines.listForGroup({ params: { id: groupId } }));
  return [...rows];
}

/** Pause a routine (manager; idempotent). */
export function pauseRoutine(id: string): Promise<Routine> {
  return callApi((client) => client.routines.pause({ params: { id } }));
}

/**
 * Resume a paused routine (manager). A routine paused for hosts_changed
 * or awaiting re-approval answers 409 `needs_approval`.
 */
export function resumeRoutine(id: string): Promise<Routine> {
  return callApi((client) => client.routines.resume({ params: { id } }));
}

/** Delete a routine (manager, idempotent). */
export async function deleteRoutine(id: string): Promise<void> {
  await callApi((client) => client.routines.remove({ params: { id } }));
}
