import { readFileSync } from 'node:fs';
import { Exit, Schema } from 'effect';

const packageJsonUrl = new URL('../package.json', import.meta.url);

const PackageJson = Schema.fromJsonString(Schema.Struct({ version: Schema.String }));

const decoded = Schema.decodeUnknownExit(PackageJson)(readFileSync(packageJsonUrl, 'utf8'));

if (Exit.isFailure(decoded)) {
  throw new Error('apps/server/package.json must contain a string "version" field');
}

export const serverVersion: string = decoded.value.version;
