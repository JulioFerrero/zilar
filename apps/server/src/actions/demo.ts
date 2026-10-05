import { z } from 'zod';
import type { ActionAdapter } from './registry';

// A harmless demo adapter used to prove the action tool end-to-end in a
// owner's DM. Exists only when `ACTION_DEMO_ENABLED=true` (T-0093); the
// production default is off, so with the flag unset this file is never
// imported. Tier 2 is deliberate: it exercises the approval path on the
// way to the success summary.

export const DEMO_ECHO_ACTION = 'demo.echo';

const DEMO_ECHO_TEXT_MIN = 1;
const DEMO_ECHO_TEXT_MAX = 200;

// The one-line description the model sees in the `request_action` tool
// definition: it must stay short and say "no side effects" so a model
// never confuses it for a real adapter.
const DEMO_ECHO_DESCRIPTION = 'Repeats a short text back (demo, no side effects).';

export const DemoEchoArgsSchema = z.object({
  text: z.string().trim().min(DEMO_ECHO_TEXT_MIN).max(DEMO_ECHO_TEXT_MAX),
});

export type DemoEchoArgs = z.infer<typeof DemoEchoArgsSchema>;

// The summary the approval card shows: one short, fixed line per call.
function describeDemoEcho(args: unknown): { summary: string } {
  const text = (args as DemoEchoArgs).text;
  return { summary: `Echo a message: "${text}"` };
}

// The adapter itself. `execute` does nothing — no I/O, no state change —
// it just hands the trimmed text back as the success summary. The
// approval path is what `request_action` lands on (tier 2); once the
// owner approves, the gateway calls this and reports the summary back
// to the model. Typed as `ActionAdapter<unknown>` so it lines up with
// the registry's contract.
//
// T-0099: `allowAlways: true` opts the demo into the standing-rule flow,
// so an owner can approve "always" in the DM and the next echo runs
// without a card. It has no `estimateCost` (and the registry rejects any
// adapter that has both), so the cost-above-zero safety rule does not
// apply.
export function buildDemoEchoAdapter(): ActionAdapter<unknown> {
  return {
    name: DEMO_ECHO_ACTION,
    description: DEMO_ECHO_DESCRIPTION,
    tier: 2,
    argsSchema: DemoEchoArgsSchema as unknown as z.ZodType<unknown>,
    describe: describeDemoEcho as ActionAdapter<unknown>['describe'],
    allowAlways: true,
    execute: async (_ctx, args) => ({
      summary: `Echoed: ${(args as DemoEchoArgs).text}`,
    }),
  };
}
