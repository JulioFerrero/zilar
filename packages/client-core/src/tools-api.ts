// effect-plain: Promise port over the contract; each app's `call` owns the Effect edge.
// The shared tools, routines and approvals calls: web and phone each supply the transport.
import type { Effect } from 'effect';
import type {
  ApprovalDecision,
  ApprovalRule,
  MyRoutine,
  PublicApproval,
  Routine,
  ToolDetail,
  ToolListItem,
  ToolRun,
  ToolRunResult,
  ToolVersion,
  ToolVersionDetail,
  ZilarClient,
} from '@zilar/api-contract';

export type {
  ApprovalDecision,
  ApprovalRule,
  ApprovalStatus,
  MyRoutine,
  PublicApproval,
  Routine,
  ToolDetail,
  ToolListItem,
  ToolRun,
  ToolRunResult,
  ToolVersion,
  ToolVersionDetail,
} from '@zilar/api-contract';

type ApiCall = <A, E>(call: (client: ZilarClient) => Effect.Effect<A, E>) => Promise<A>;

/** Tools and their version history, runs and routines, over the caller's `call`. */
export function makeToolsApi(call: ApiCall) {
  return {
    listAiTools: (aiId: string): Promise<ToolListItem[]> =>
      call((c) => c.tools.listForAi({ params: { id: aiId } })).then((rows) => [...rows]),

    listGroupTools: (groupId: string): Promise<ToolListItem[]> =>
      call((c) => c.tools.listForGroup({ params: { id: groupId } })).then((rows) => [...rows]),

    listTopicTools: (topicId: string): Promise<ToolListItem[]> =>
      call((c) => c.tools.listForTopic({ params: { id: topicId } })).then((rows) => [...rows]),

    getTool: (id: string): Promise<ToolDetail> => call((c) => c.tools.detail({ params: { id } })),

    listToolVersions: (id: string): Promise<ToolVersion[]> =>
      call((c) => c.tools.versions({ params: { id } })).then((rows) => [...rows]),

    getToolVersion: (id: string, version: number): Promise<ToolVersionDetail> =>
      call((c) => c.tools.version({ params: { id, n: String(version) } })),

    listToolRuns: (id: string): Promise<ToolRun[]> =>
      call((c) => c.tools.runs({ params: { id } })).then((rows) => [...rows]),

    revertTool: (id: string, version: number): Promise<ToolVersion> =>
      call((c) => c.tools.revert({ params: { id }, payload: { version } })),

    // `input` must serialise to at most 16 KiB; the server answers 400 above that.
    runToolNow: (id: string, input?: unknown): Promise<ToolRunResult> =>
      call((c) => c.tools.run({ params: { id }, payload: input === undefined ? {} : { input } })),

    deleteTool: (id: string): Promise<void> =>
      call((c) => c.tools.remove({ params: { id } })).then(() => undefined),

    listMyRoutines: (): Promise<MyRoutine[]> =>
      call((c) => c.routines.listMine()).then((rows) => [...rows]),

    listAiRoutines: (aiId: string): Promise<Routine[]> =>
      call((c) => c.routines.listForAi({ params: { id: aiId } })).then((rows) => [...rows]),

    listGroupRoutines: (groupId: string): Promise<Routine[]> =>
      call((c) => c.routines.listForGroup({ params: { id: groupId } })).then((rows) => [...rows]),

    listTopicRoutines: (topicId: string): Promise<Routine[]> =>
      call((c) => c.routines.listForTopic({ params: { id: topicId } })).then((rows) => [...rows]),

    pauseRoutine: (id: string): Promise<Routine> =>
      call((c) => c.routines.pause({ params: { id } })),

    resumeRoutine: (id: string): Promise<Routine> =>
      call((c) => c.routines.resume({ params: { id } })),

    deleteRoutine: (id: string): Promise<void> =>
      call((c) => c.routines.remove({ params: { id } })).then(() => undefined),
  };
}

/** Pending approvals and the per-AI or per-group rules that allow an action always. */
export function makeApprovalsApi(call: ApiCall) {
  return {
    getApproval: (id: string): Promise<PublicApproval> =>
      call((c) => c.approvals.detail({ params: { id } })),

    listApprovals: (): Promise<PublicApproval[]> =>
      call((c) => c.approvals.list()).then((rows) => [...rows]),

    decideApproval: (
      id: string,
      decision: ApprovalDecision,
      note?: string,
    ): Promise<PublicApproval> =>
      call((c) =>
        c.approvals.decide({
          params: { id },
          payload: note === undefined ? { decision } : { decision, note },
        }),
      ),

    listAiApprovalRules: (aiId: string): Promise<ApprovalRule[]> =>
      call((c) => c.approvals.aiRules({ params: { id: aiId } })).then((rows) => [...rows]),

    listGroupApprovalRules: (groupId: string): Promise<ApprovalRule[]> =>
      call((c) => c.approvals.groupRules({ params: { id: groupId } })).then((rows) => [...rows]),

    revokeApprovalRule: (id: string): Promise<void> =>
      call((c) => c.approvals.revokeRule({ params: { id } })).then(() => undefined),
  };
}
