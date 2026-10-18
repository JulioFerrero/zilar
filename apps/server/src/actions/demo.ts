import { Schema } from 'effect';
import type { ActionAdapter } from './registry';

// A harmless demo adapter, alive only when `ACTION_DEMO_ENABLED=true`; off by default.
// Tier 2 exercises the approval path.

export const DEMO_ECHO_ACTION = 'demo.echo';

const DEMO_ECHO_TEXT_MIN = 1;
const DEMO_ECHO_TEXT_MAX = 200;

// Must stay short and say "no side effects" so a model never mistakes it for a real adapter.
const DEMO_ECHO_DESCRIPTION = 'Repeats a short text back (demo, no side effects).';

export const DemoEchoArgsSchema = Schema.Struct({
  text: Schema.Trim.check(
    Schema.isMinLength(DEMO_ECHO_TEXT_MIN),
    Schema.isMaxLength(DEMO_ECHO_TEXT_MAX),
  ),
});

export type DemoEchoArgs = typeof DemoEchoArgsSchema.Type;

function describeDemoEcho(args: unknown): { summary: string } {
  const text = (args as DemoEchoArgs).text;
  return { summary: `Echo a message: "${text}"` };
}

// Does nothing — no I/O, no state change — and hands the trimmed text back as the summary.
// `allowAlways` opts into standing approval; it reports no cost, so the cost safety rule does not apply.
export function buildDemoEchoAdapter(): ActionAdapter<unknown> {
  return {
    name: DEMO_ECHO_ACTION,
    description: DEMO_ECHO_DESCRIPTION,
    tier: 2,
    argsSchema: DemoEchoArgsSchema as unknown as Schema.Codec<unknown, unknown, never>,
    describe: describeDemoEcho as ActionAdapter<unknown>['describe'],
    allowAlways: true,
    execute: async (_ctx, args) => ({
      summary: `Echoed: ${(args as DemoEchoArgs).text}`,
    }),
  };
}
