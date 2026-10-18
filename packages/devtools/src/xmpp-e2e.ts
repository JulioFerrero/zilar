// End-to-end spike for the XMPP chat backbone (plan §23, spike S1): `pnpm xmpp:e2e`
// against the dev stack exercises account and room creation through the admin API,
// JWT login, a members-only MUC conversation and MAM history, plus the ways in
// that must fail. One line per step; a non-zero exit when any step fails.
import { errorMessage } from './xmpp-e2e/harness';
import { main } from './xmpp-e2e/main';

try {
  await main();
} catch (error) {
  console.error(`FAIL  ${errorMessage(error)}`);
  process.exitCode = 1;
}
