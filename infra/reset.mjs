#!/usr/bin/env node
// `pnpm infra:reset`: stops the dev stack and deletes its data volumes after
// an explicit confirmation. Run from any working directory.
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const composeFile = fileURLToPath(new URL('docker-compose.dev.yml', import.meta.url));
const envFile = fileURLToPath(new URL('.env', import.meta.url));

const readline = createInterface({ input: process.stdin, output: process.stdout });
const answer = await readline.question(
  'This deletes every Galena dev volume (Postgres data and ejabberd uploads).\n' +
    'Type "yes" to continue: ',
);
readline.close();

if (answer.trim().toLowerCase() !== 'yes') {
  console.log('Aborted. Nothing was deleted.');
  process.exit(0);
}

execFileSync('docker', ['compose', '-f', composeFile, '--env-file', envFile, 'down', '--volumes'], {
  stdio: 'inherit',
});
console.log('Volumes removed. `pnpm infra:up` starts again from a clean database.');
