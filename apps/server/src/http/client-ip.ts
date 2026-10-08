// The client-IP rule shared by the Hono rate limiters (join, pairing,
// setup) and, later, their Effect HTTP replacements. Pure functions on
// plain inputs: with 0 trusted proxy hops (the default) the socket address
// is used and proxy headers are ignored — anyone can forge them. With N > 0
// (behind N proxies, e.g. Caddy) the client IP is the Nth address from the
// RIGHT of `x-forwarded-for`: the proxies append truthfully on the right
// while an attacker controls only the left side.

// The Nth address from the right of an `x-forwarded-for` header, or null
// when the header is missing or has fewer than N addresses. Empty entries
// never count as an address.
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

// The client IP for a per-IP limiter: with trusted proxy hops the Nth
// address from the right of `x-forwarded-for`, otherwise the socket
// address.
export function clientIpFrom(input: ClientIpInput, trustedProxyHops: number): string {
  if (trustedProxyHops > 0) {
    const forwarded = trustedClientIp(input.forwardedFor, trustedProxyHops);
    if (forwarded !== null) {
      return forwarded;
    }
  }
  return input.socketAddress;
}
