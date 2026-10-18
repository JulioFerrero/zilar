// The client-IP rule. With 0 trusted proxy hops (the default) the socket address is used
// and proxy headers are ignored: anyone can forge them. With N > 0 the client IP is the
// Nth address from the RIGHT of `x-forwarded-for`, since only the left side is attacker-
// controlled.

// The edge resolves the IP once and writes it here; Better Auth reads only this header.
// The edge overwrites any incoming value, so a client cannot pick its own bucket.
export const CLIENT_IP_HEADER = 'x-zilar-client-ip';

export function trustedClientIp(header: string | undefined, hops: number): string | null {
  if (header === undefined) {
    return null;
  }
  const addresses = header
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (addresses.length < hops || hops < 1) {
    return null;
  }
  return addresses[addresses.length - hops] ?? null;
}

export interface ClientIpInput {
  readonly forwardedFor: string | undefined;
  readonly socketAddress: string;
}

export function clientIpFrom(input: ClientIpInput, trustedProxyHops: number): string {
  if (trustedProxyHops > 0) {
    const forwarded = trustedClientIp(input.forwardedFor, trustedProxyHops);
    if (forwarded !== null) {
      return forwarded;
    }
  }
  return input.socketAddress;
}
