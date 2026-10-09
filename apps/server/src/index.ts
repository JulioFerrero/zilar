import { NodeRuntime } from '@effect/platform-node';
import { serverProgram, serverTeardown } from './main';

NodeRuntime.runMain(serverProgram, { teardown: serverTeardown });
