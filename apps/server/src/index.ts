import { NodeRuntime } from '@effect/platform-node';
import { serverProgram } from './main';
import { serverTeardown } from './startup/lifecycle';

NodeRuntime.runMain(serverProgram, { teardown: serverTeardown });
