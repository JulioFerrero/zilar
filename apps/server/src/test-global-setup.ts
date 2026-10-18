import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { TestProject } from 'vitest/node';
import { migratePglite } from './effect/sql';

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const directory = await mkdtemp(join(tmpdir(), 'zilar-pglite-snapshot-'));
  const template = new PGlite();
  await migratePglite(template);
  const snapshot = await template.dumpDataDir('none');
  await template.close();
  const path = join(directory, 'migrated.tar');
  await writeFile(path, Buffer.from(await snapshot.arrayBuffer()));
  project.provide('migratedSnapshotPath', path);
  return () => rm(directory, { recursive: true, force: true });
}
