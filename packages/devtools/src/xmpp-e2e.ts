// End-to-end spike for the XMPP chat backbone (plan §23, spike S1).
//
//   pnpm xmpp:e2e
//
// Run against the dev stack (pnpm infra:up). It exercises what the product
// needs from ejabberd: our server creates accounts and rooms through the admin
// API, clients log in with a short-lived JWT, two users talk in a members-only
// MUC room, and the history comes back through MAM. It also checks the ways in
// should not work (expired token, wrong secret, non-member join, user-created
// room). One line per step; a non-zero exit code if any step fails.
import { errorMessage } from './xmpp-e2e/harness';
import { main } from './xmpp-e2e/main';

try {
  await main();
} catch (error) {
  console.error(`FAIL  ${errorMessage(error)}`);
  process.exitCode = 1;
}
