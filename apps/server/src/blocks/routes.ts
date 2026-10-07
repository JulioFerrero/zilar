// Compatibility re-export (T-0514): `blocks.test.ts` imports the legacy Hono
// factory and the write-limit constant from this path to exercise the
// injected rate limiters. The Effect mount and the factory both live in
// `./api`.
export {
  BLOCK_READ_RATE_LIMIT_MAX,
  BLOCK_READ_RATE_LIMIT_WINDOW_MS,
  BLOCK_WRITE_RATE_LIMIT_MAX,
  BLOCK_WRITE_RATE_LIMIT_WINDOW_MS,
  createBlocksRoutes,
} from './api';
