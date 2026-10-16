// The `lead` entry point. The command functions live under `cli/` (T-1468);
// this file keeps `main`, the entry check and the call, and stays invoked as
// `pnpm exec tsx src/lead/cli.ts <command>`.

import { runForget } from './forget.js';
import { runStatus } from './status.js';
import { runWatch, runWatchData } from './watch.js';
import { HELP } from './cli/help.js';
import {
  runAutopilotCommand,
  runDoctor,
  runLaunch,
  runPrereview,
  runReply,
  runSnapshot,
  runSpecCheck,
  runSwitchModel,
} from './cli/commands.js';
import { runBatch, runMerge, runPush } from './cli/merge.js';

export async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  const positional = rest.filter((arg) => !arg.startsWith('--'));
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    console.log(HELP);
    return;
  }
  if (command === 'launch') {
    await runLaunch(rest);
  } else if (command === 'switch-model') {
    await runSwitchModel(positional, rest);
  } else if (command === 'autopilot') {
    await runAutopilotCommand(positional, rest);
  } else if (command === 'doctor') {
    await runDoctor(positional, rest);
  } else if (command === 'prereview') {
    await runPrereview(positional);
  } else if (command === 'reply') {
    await runReply(positional, rest);
  } else if (command === 'snapshot') {
    await runSnapshot(positional, false);
  } else if (command === 'dashboard') {
    await runSnapshot(positional, true);
  } else if (command === 'spec-check') {
    runSpecCheck(positional);
  } else if (command === 'merge') {
    await runMerge(positional, rest);
  } else if (command === 'push') {
    await runPush();
  } else if (command === 'batch') {
    await runBatch(positional);
  } else if (command === 'forget') {
    await runForget(positional, rest);
  } else if (command === 'status') {
    await runStatus();
  } else if (command === 'watch') {
    if (rest.includes('--data')) {
      await runWatchData();
    } else {
      await runWatch({ noIcons: rest.includes('--no-icons') });
    }
  } else {
    throw new Error(`unknown command ${JSON.stringify(command)} (try: lead --help)`);
  }
}

const invoked = process.argv[1] !== undefined && process.argv[1].endsWith('cli.ts');
if (invoked) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(`lead: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
