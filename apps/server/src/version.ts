import { readFileSync } from 'node:fs';

const packageJsonUrl = new URL('../package.json', import.meta.url);
const packageJson: unknown = JSON.parse(readFileSync(packageJsonUrl, 'utf8'));

if (
  typeof packageJson !== 'object' ||
  packageJson === null ||
  !('version' in packageJson) ||
  typeof packageJson.version !== 'string'
) {
  throw new Error('apps/server/package.json must contain a string "version" field');
}

export const serverVersion: string = packageJson.version;
