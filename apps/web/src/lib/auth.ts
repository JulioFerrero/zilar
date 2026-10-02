import { createAuthClient } from 'better-auth/react';
import { emailOTPClient } from 'better-auth/client/plugins';

/** Header the server reads to attribute a sign-up to an invite (T-0015/T-0020). */
export const INVITE_HEADER = 'x-zilar-invite';

/**
 * Better Auth's browser client. Requests are same-origin, because the Vite dev
 * server proxies `/api` to the server and cookies stay first-party.
 */
export const authClient = createAuthClient({
  plugins: [emailOTPClient()],
});

function inviteHeaders(
  inviteCode: string | undefined,
): { headers: Record<string, string> } | object {
  return inviteCode === undefined || inviteCode === ''
    ? {}
    : { headers: { [INVITE_HEADER]: inviteCode } };
}

export function sendSignInCode(email: string, inviteCode?: string) {
  return authClient.emailOtp.sendVerificationOtp({
    email,
    type: 'sign-in',
    fetchOptions: inviteHeaders(inviteCode),
  });
}

export function verifySignInCode(email: string, otp: string, inviteCode?: string) {
  return authClient.signIn.emailOtp({
    email,
    otp,
    fetchOptions: inviteHeaders(inviteCode),
  });
}

export function signOut() {
  return authClient.signOut();
}
