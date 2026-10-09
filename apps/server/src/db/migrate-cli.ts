import { NodeRuntime } from '@effect/platform-node';
import { Effect } from 'effect';
import { loadServerConfigOrExit } from '../config';
import { createLogger } from '../logger';
import { disposeSqlRuntime, registerSqlRuntime } from '../effect/sql';
import { createDb } from './client';
import { runMigrations } from './migrate';

const migrateProgram = Effect.gen(function* () {
  const config = loadServerConfigOrExit(process.env);
  const logger = createLogger(config);

  const { db, close } = createDb(config.DATABASE_URL);

  // Dispose the `effect/sql` pool before closing the drizzle client it shares
  // the database with.
  const release = Effect.promise(() => disposeSqlRuntime(db)).pipe(
    Effect.andThen(Effect.promise(() => close())),
  );

  yield* Effect.gen(function* () {
    // The migrator runs on `effect/sql`, so this script registers the runtime too.
    registerSqlRuntime(db, config.DATABASE_URL);
    yield* Effect.promise(() => runMigrations(db));
    logger.info('database migrations applied');
  }).pipe(Effect.ensuring(release));
});

NodeRuntime.runMain(migrateProgram);
