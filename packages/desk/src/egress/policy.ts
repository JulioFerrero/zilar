// effect-plain: the egress policy is pure DNS + classification over an injected
// resolver; it opens no socket itself, so it stays easy to test.
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { classifyIp, isIpLiteral } from './ip-guard';

export type ResolveHost = (host: string) => Promise<readonly string[]>;

/** The ports the proxy ever connects to: 443 to tunnel, 80 for plain HTTP. */
export const ALLOWED_PORTS: readonly number[] = [443, 80];

/** The fixed decision codes; they reach the host log and never a URL. */
export type DenyReason =
  | 'host'
  | 'ip-literal'
  | 'port'
  | 'host-not-allowed'
  | 'resolve-failed'
  | 'no-address'
  | 'blocked-address';

export interface TargetCheck {
  readonly host: string;
  readonly port: number;
  /** `null` is the open web; a list — even an empty one — is the per-desk allowlist. */
  readonly allowedHosts: readonly string[] | null;
}

export type TargetDecision =
  | { readonly allow: true; readonly address: string }
  | { readonly allow: false; readonly reason: DenyReason };

export interface PolicyOptions {
  readonly resolver?: ResolveHost | undefined;
  readonly allowedPorts?: readonly number[] | undefined;
}

export const resolveAll: ResolveHost = async (host) => {
  const records = await dnsLookup(host, { all: true });
  return records.map((record) => record.address);
};

/** Lowercase, drop one trailing dot: `Example.COM.` and `example.com` match. */
export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '');
}

export function isHostAllowed(host: string, allowedHosts: readonly string[]): boolean {
  const normalized = normalizeHost(host);
  return allowedHosts.some((entry) => normalizeHost(entry) === normalized);
}

const deny = (reason: DenyReason): TargetDecision => ({ allow: false, reason });

/**
 * Refuses IP literals, other ports, hosts outside the allowlist and any host with
 * a blocked address; every resolved address is checked, so rebinding fails.
 */
export async function checkTarget(
  target: TargetCheck,
  options: PolicyOptions = {},
): Promise<TargetDecision> {
  const resolver = options.resolver ?? resolveAll;
  const allowedPorts = options.allowedPorts ?? ALLOWED_PORTS;
  const host = normalizeHost(target.host);
  if (host.length === 0) {
    return deny('host');
  }
  if (isIpLiteral(host)) {
    return deny('ip-literal');
  }
  if (!allowedPorts.includes(target.port)) {
    return deny('port');
  }
  if (target.allowedHosts !== null && !isHostAllowed(host, target.allowedHosts)) {
    return deny('host-not-allowed');
  }
  let addresses: readonly string[];
  try {
    addresses = await resolver(host);
  } catch {
    return deny('resolve-failed');
  }
  if (addresses.length === 0) {
    return deny('no-address');
  }
  for (const address of addresses) {
    if (isIP(address) === 0 || classifyIp(address) === 'blocked') {
      return deny('blocked-address');
    }
  }
  return { allow: true, address: addresses[0] as string };
}
