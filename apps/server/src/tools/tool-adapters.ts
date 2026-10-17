// effect-plain: moved unchanged from apps/server/src/tools/adapters.ts (size split)
// T-0966: the `tool.*` adapters, split out of `tools/adapters.ts` unchanged.
import type { Schema } from 'effect';
import type { Payload } from '@zilar/protocol';
import type { ActionAdapter, ActionContext } from '../actions/registry';
import { buildBlocksPayload } from '../message-blocks/build';
import { withoutMedia } from '../message-blocks/media-ids';
import { truncateChars } from '../text';
import {
  MAX_SAVE_MODEL_TEXT_CHARS,
  MAX_TOOL_POST_CHARS,
  findToolByName,
  hostsLine,
  ownerOf,
  plural,
  routinesInScope,
  serviceFailure,
  type AdapterState,
} from './adapter-support';
import { cardHeader, describeToolCard, readableToolName } from './card-header';
import { routineLine, pendingApprovalLine, pendingRoutineApprovals } from './routine-list-lines';
import {
  getTool,
  getVersion,
  listTools,
  revertTool,
  runToolVersion,
  saveToolVersion,
  ToolServiceError,
} from './service';
import {
  toolListArgsSchema,
  toolReadArgsSchema,
  toolRevertArgsSchema,
  toolRunArgsSchema,
  toolSaveArgsSchema,
} from './tool-arg-schemas';

export function toolListAdapter(state: AdapterState): ActionAdapter<unknown> {
  return {
    name: 'tool.list',
    description: 'List the tools and routines in this topic, with versions, hosts and schedules.',
    tier: 0,
    argsExample: '{}',
    argsSchema: toolListArgsSchema as unknown as Schema.Codec<unknown, unknown, never>,
    describe: () => ({ summary: 'List the tools and routines in this topic' }),
    execute: async (ctx, _args) => {
      const actionCtx = ctx as ActionContext;
      const tools = await listTools(state.db, {
        aiId: actionCtx.aiId,
        groupId: actionCtx.groupId,
        topicId: actionCtx.topicId,
      });
      const routines = await routinesInScope(state, actionCtx);
      const pending = await pendingRoutineApprovals(state, actionCtx);
      const toolLines = tools.map(
        (tool) =>
          `- ${tool.name} v${tool.currentVersion}: ${tool.description} (${hostsLine(tool.hosts)})`,
      );
      const routineLines = routines.map(routineLine);
      const pendingLines = pending.map(pendingApprovalLine);
      const lines = [...toolLines, ...routineLines, ...pendingLines];
      const waiting = pending.length === 0 ? '' : `, ${plural(pending.length, 'approval')} waiting`;
      return {
        summary: `${plural(tools.length, 'tool')}, ${plural(routines.length, 'routine')}${waiting}`,
        modelText: lines.length === 0 ? 'No tools or routines in this topic.' : lines.join('\n'),
      };
    },
  };
}

export function toolReadAdapter(state: AdapterState): ActionAdapter<unknown> {
  return {
    name: 'tool.read',
    description: "Read one tool's source and hosts in this topic, optionally at an older version.",
    tier: 0,
    argsExample: '{"name":"daily-report"}',
    argsSchema: toolReadArgsSchema as unknown as Schema.Codec<unknown, unknown, never>,
    describe: (args) => {
      const parsed = args as { name: string; version?: number };
      return {
        summary:
          parsed.version === undefined
            ? `Read the tool "${parsed.name}"`
            : `Read the tool "${parsed.name}" at v${parsed.version}`,
      };
    },
    execute: async (ctx, args) => {
      const actionCtx = ctx as ActionContext;
      const parsed = args as { name: string; version?: number };
      const found = await findToolByName(state, actionCtx, parsed.name);
      if (!found) {
        return { summary: 'no such tool' };
      }
      if (parsed.version === undefined) {
        const tool = await getTool(state.db, found.id);
        if (!tool) {
          return { summary: 'no such tool' };
        }
        return {
          summary: `${tool.name} v${tool.currentVersion}`,
          modelText: `${tool.name} v${tool.currentVersion} (hosts: ${hostsLine(tool.hosts)})\n${tool.source}`,
        };
      }
      const version = await getVersion(state.db, found.id, parsed.version);
      if (!version) {
        return { summary: 'no such version' };
      }
      return {
        summary: `${found.name} v${version.version}`,
        modelText: `${found.name} v${version.version} (hosts: ${hostsLine(version.hosts)})\n${version.source}`,
      };
    },
  };
}

export function toolSaveAdapter(state: AdapterState): ActionAdapter<unknown> {
  return {
    name: 'tool.save',
    description: 'Save a new version of a tool in this topic and test-run it in the sandbox.',
    tier: 1,
    argsExample:
      '{"name":"daily-report","description":"Fetch prices","source":"return 1","hosts":["api.example.com"],"message":"v1"}',
    argsSchema: toolSaveArgsSchema as unknown as Schema.Codec<unknown, unknown, never>,
    describe: (args) => {
      const parsed = args as { name: string };
      return { summary: `Save the tool "${parsed.name}"` };
    },
    execute: async (ctx, args) => {
      const actionCtx = ctx as ActionContext;
      const parsed = args as {
        name: string;
        description: string;
        source: string;
        hosts: string[];
        message: string;
      };
      const owner = await ownerOf(state.db, actionCtx.aiId);
      let saved;
      try {
        saved = await saveToolVersion(
          state.db,
          {
            aiId: actionCtx.aiId,
            groupId: actionCtx.groupId,
            topicId: actionCtx.topicId,
            name: parsed.name,
            description: parsed.description,
            source: parsed.source,
            hosts: parsed.hosts,
            message: parsed.message,
            userId: owner,
          },
          state.now(),
          ...(state.audit === undefined ? [] : ([state.audit] as const)),
        );
      } catch (error) {
        if (error instanceof ToolServiceError) {
          return { summary: serviceFailure(error) };
        }
        throw error;
      }
      const head = `saved ${saved.tool.name} v${saved.version.version}`;
      if (saved.unchanged) {
        return { summary: `${head} (unchanged)` };
      }
      // T-0132: a version that declares any host outside the approved set
      // keeps working without that host (no network for it) until a new
      // `tool.approve_hosts` is approved. The model text names the
      // unapproved hosts so the model can ask for approval.
      const unapproved = saved.version.hosts.filter(
        (host) => !saved.tool.approvedHosts.includes(host),
      );
      const approvalHint =
        unapproved.length === 0
          ? ''
          : ` Unapproved hosts (no network for them yet): ${hostsLine(unapproved)}. Ask for tool.approve_hosts to allow them.`;
      // The save itself is never rolled back when the test run fails: the
      // model fixes the code in the next call.
      let testSummary: string;
      let testText: string;
      try {
        const { result } = await runToolVersion(
          { db: state.db, runner: state.runner },
          {
            toolId: saved.tool.id,
            version: saved.version.version,
            input: null,
            trigger: 'ai',
          },
          state.now(),
        );
        if (result.ok) {
          testSummary = 'test run ok';
          testText = result.output.text;
          // T-1768: tell the AI whether its card would post, from the same
          // check `tool.run` applies. A tool without blocks gets no line.
          const cardLine = describeToolCard(result.output, saved.tool.name);
          if (cardLine !== null) {
            testSummary = `test run ok, ${cardLine}`;
            testText = `${testText}\n${cardLine}`;
          }
        } else {
          testSummary = `test run failed: ${result.error.kind}`;
          testText =
            result.logs === '' ? result.error.message : `${result.error.message}\n${result.logs}`;
        }
      } catch (error) {
        if (error instanceof ToolServiceError) {
          return { summary: `${head}: test run failed: ${error.errorCode}` };
        }
        throw error;
      }
      return {
        summary: `${head}: ${testSummary}${approvalHint}`,
        modelText: truncateChars(testText + approvalHint, MAX_SAVE_MODEL_TEXT_CHARS),
      };
    },
  };
}

export function toolRunAdapter(state: AdapterState): ActionAdapter<unknown> {
  return {
    name: 'tool.run',
    description: "Run this topic's tool now and post its output into the topic.",
    tier: 1,
    argsExample: '{"name":"daily-report"}',
    argsSchema: toolRunArgsSchema as unknown as Schema.Codec<unknown, unknown, never>,
    describe: (args) => {
      const parsed = args as { name: string };
      return { summary: `Run the tool "${parsed.name}"` };
    },
    execute: async (ctx, args) => {
      const actionCtx = ctx as ActionContext;
      const parsed = args as { name: string; input?: unknown };
      const key = `${actionCtx.aiId}\n${actionCtx.groupId ?? ''}\n${actionCtx.topicId ?? ''}`;
      if (!state.runLimiter.allow(key)) {
        return { summary: 'run limit reached, try later' };
      }
      const found = await findToolByName(state, actionCtx, parsed.name);
      if (!found) {
        return { summary: 'no such tool' };
      }
      let ran;
      try {
        ran = await runToolVersion(
          { db: state.db, runner: state.runner },
          {
            toolId: found.id,
            input: parsed.input ?? null,
            trigger: 'ai',
          },
          state.now(),
        );
      } catch (error) {
        if (error instanceof ToolServiceError) {
          if (error.errorCode === 'not_found') {
            return { summary: 'no such tool' };
          }
          return { summary: serviceFailure(error) };
        }
        throw error;
      }
      if (!ran.result.ok) {
        const failure = ran.result;
        return {
          summary: failure.error.kind,
          modelText:
            failure.logs === ''
              ? failure.error.message
              : `${failure.error.message}\n${failure.logs}`,
        };
      }
      const text = ran.result.output.text;
      // T-1761: a saved tool may return `blocks`. T-1766: it may also return a
      // `card` header. A valid set rides on the post as a `blocks` card; a
      // broken set falls back to today's plain text (the reason is never
      // logged, the AI id only). The live example the user sees is still the
      // output posted as the AI into the topic. A `false` answer (stopped AI,
      // left room) still returns the normal result — delivery is best-effort.
      const blocks = ran.result.output.blocks;
      const card = cardHeader(ran.result.output.card);
      const postText = `${found.name}\n${truncateChars(text, MAX_TOOL_POST_CHARS)}`;
      const postArgs = (payload?: Payload) => ({
        aiId: actionCtx.aiId,
        groupId: actionCtx.groupId,
        ...(actionCtx.topicId === null ? {} : { topicId: actionCtx.topicId }),
        text: postText,
        ...(payload === undefined ? {} : { payload }),
      });
      let posted = false;
      try {
        if (blocks === undefined) {
          posted = await state.post(postArgs());
        } else {
          const built = buildBlocksPayload(
            {
              title: card.title ?? readableToolName(found.name),
              icon: card.icon,
              meta: card.meta,
              // T-1872: a saved tool cannot fetch media, so it never posts a
              // media block or a map image.
              blocks: Array.isArray(blocks) ? withoutMedia(blocks) : blocks,
            },
            text,
          );
          if (built.ok) {
            posted = await state.post(postArgs(built.payload));
          } else {
            // T-1761: route the ops warning through the gateway's redacting
            // logger (the one `ActionContext` carries), not `console.warn`;
            // ids only, never the reason.
            actionCtx.logger?.warn({ aiId: actionCtx.aiId }, 'tool.run blocks invalid');
            posted = await state.post(postArgs());
          }
        }
      } catch {
        // Best-effort like the gateway announcer: a throwing chat layer
        // never turns a good run into a failure.
      }
      return { summary: 'ok', modelText: text, ...(posted ? { posted: true } : {}) };
    },
  };
}

export function toolRevertAdapter(state: AdapterState): ActionAdapter<unknown> {
  return {
    name: 'tool.revert',
    description: 'Revert a tool in this topic to an older version (appends a new version).',
    tier: 1,
    argsExample: '{"name":"daily-report","toVersion":1}',
    argsSchema: toolRevertArgsSchema as unknown as Schema.Codec<unknown, unknown, never>,
    describe: (args) => {
      const parsed = args as { name: string; toVersion: number };
      return { summary: `Revert the tool "${parsed.name}" to v${parsed.toVersion}` };
    },
    execute: async (ctx, args) => {
      const actionCtx = ctx as ActionContext;
      const parsed = args as { name: string; toVersion: number };
      const found = await findToolByName(state, actionCtx, parsed.name);
      if (!found) {
        return { summary: 'no such tool' };
      }
      const old = await getVersion(state.db, found.id, parsed.toVersion);
      if (!old) {
        return { summary: 'no such version' };
      }
      const owner = await ownerOf(state.db, actionCtx.aiId);
      try {
        const { tool } = await revertTool(
          state.db,
          { toolId: found.id, toVersion: parsed.toVersion, userId: owner },
          state.now(),
        );
        return {
          summary: `reverted ${tool.name} to v${parsed.toVersion} (now v${tool.currentVersion})`,
        };
      } catch (error) {
        if (error instanceof ToolServiceError) {
          if (error.errorCode === 'not_found') {
            return { summary: 'no such version' };
          }
          return { summary: serviceFailure(error) };
        }
        throw error;
      }
    },
  };
}
