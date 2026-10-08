// The XMPP router moved to `./api` (T-0533). This file only re-exports the
// token constants that the existing route tests still import from here.
export { TOKEN_RATE_LIMIT_MAX, TOKEN_RATE_LIMIT_WINDOW_MS, TOKEN_TTL_SECONDS } from './api';
