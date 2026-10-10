import { Effect } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { HttpError } from '../errors';
import type {
  PublicTool,
  PublicToolRun,
  PublicToolVersion,
  runToolVersion,
  ToolDetail,
  ToolVersionDetail,
} from './service';
import { ToolServiceError } from './service';

// `input` serialises to at most 16 KiB (T-0105, shared with the `tool.run`
// adapter): anything larger is 400 `invalid_request` before any run.
export const MAX_TOOL_RUN_INPUT_BYTES = 16 * 1024;

export function toListWire(tool: PublicTool & { scope: 'personal' | 'group' }) {
  return {
    id: tool.id,
    aiId: tool.aiId,
    groupId: tool.groupId,
    topicId: tool.topicId,
    name: tool.name,
    description: tool.description,
    currentVersion: tool.currentVersion,
    hosts: [...tool.hosts],
    approvedHosts: [...tool.approvedHosts],
    lastRunStatus: tool.lastRunStatus,
    updatedAt: tool.updatedAt.toISOString(),
    scope: tool.scope,
  };
}

export function toDetailWire(tool: ToolDetail) {
  return {
    ...toListWire({
      ...tool,
      scope: tool.groupId === null ? ('personal' as const) : ('group' as const),
    }),
    source: tool.source,
  };
}

export function toVersionListWire(version: PublicToolVersion) {
  return {
    id: version.id,
    toolId: version.toolId,
    version: version.version,
    message: version.message,
    hosts: [...version.hosts],
    createdBy: version.createdBy,
    createdAt: version.createdAt.toISOString(),
  };
}

export function toVersionDetailWire(version: ToolVersionDetail) {
  return {
    ...toVersionListWire(version),
    source: version.source,
  };
}

export function toRunListWire(run: PublicToolRun) {
  return {
    id: run.id,
    toolId: run.toolId,
    version: run.version,
    trigger: run.trigger,
    status: run.status,
    errorKind: run.errorKind,
    durationMs: run.durationMs,
    fetchCount: run.fetchCount,
    outputText: run.outputText,
    createdAt: run.createdAt.toISOString(),
  };
}

export function toRevertWire(
  tool: { id: string; name: string },
  version: {
    id: string;
    toolId: string;
    version: number;
    message: string;
    hosts: string[];
    createdBy: string;
    createdAt: Date;
  },
) {
  return {
    id: version.id,
    toolId: version.toolId,
    version: version.version,
    message: version.message,
    hosts: [...version.hosts],
    createdBy: version.createdBy,
    createdAt: version.createdAt.toISOString(),
    toolName: tool.name,
  };
}

export function toRunWire(result: Awaited<ReturnType<typeof runToolVersion>>['result']) {
  if (result.ok) {
    return {
      ok: true as const,
      output: {
        text: result.output.text,
        ...(result.output.data === undefined ? null : { data: result.output.data }),
      },
      logs: result.logs,
      durationMs: result.durationMs,
      fetchCount: result.fetchCount,
    };
  }
  return {
    ok: false as const,
    error: result.error,
    logs: result.logs,
    durationMs: result.durationMs,
    fetchCount: result.fetchCount,
  };
}

// The old `runBodySchema` refine: `input` must serialise to at most 16 KiB
// of UTF-8, and a value that cannot be stringified fails.
export function runInputWithinLimit(input: unknown): boolean {
  if (input === undefined) {
    return true;
  }
  let serialised: string | null;
  try {
    serialised = JSON.stringify(input) ?? 'null';
  } catch {
    return false;
  }
  return Buffer.byteLength(serialised, 'utf8') <= MAX_TOOL_RUN_INPUT_BYTES;
}

// Reads the request body as JSON without throwing: a malformed body answers
// `Invalid JSON body`, exactly like the old `readJson`.
export function readJsonBody(
  request: HttpServerRequest.HttpServerRequest,
): Effect.Effect<{ parsed: boolean; value: unknown }> {
  return request.json.pipe(
    Effect.map((value: unknown) => ({ parsed: true as const, value })),
    Effect.catchCause(() =>
      Effect.succeed({ parsed: false as const, value: undefined as unknown }),
    ),
  );
}

function mapServiceError(error: unknown): unknown {
  if (error instanceof ToolServiceError) {
    if (error.errorCode === 'not_found') {
      return new HttpError(404, 'not_found', 'Tool not found');
    }
    if (error.errorCode === 'ai_not_active') {
      return new HttpError(409, 'ai_not_active', 'The AI is not active');
    }
    if (error.errorCode === 'version_limit' || error.errorCode === 'tool_limit') {
      return new HttpError(400, error.errorCode, error.message);
    }
    return new HttpError(400, 'invalid_request', error.message);
  }
  return error;
}

// Service rejections travel as defects (`Effect.promise`), which `try/catch`
// inside `Effect.gen` cannot see: map them with `catchDefect` and re-die so
// the envelope renders the mapped answer. Unknown rejections pass through
// unchanged and stay a 500, exactly like the old route's unmapped throw.
export function withServiceErrors<A>(promise: () => Promise<A>): Effect.Effect<A> {
  return Effect.promise(promise).pipe(
    Effect.catchDefect((defect) => Effect.die(mapServiceError(defect))),
  );
}
