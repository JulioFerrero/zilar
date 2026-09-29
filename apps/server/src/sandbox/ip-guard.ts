import { isIP } from 'node:net';

export type IpClassification = 'public' | 'blocked';

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return null;
  }
  let value = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return null;
    }
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) {
      return null;
    }
    value = value * 256 + n;
  }
  return value >>> 0;
}

function inCidrV4(ip: string, cidr: string): boolean {
  const slash = cidr.indexOf('/');
  const base = cidr.slice(0, slash);
  const bits = Number(cidr.slice(slash + 1));
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt === null || baseInt === null) {
    return false;
  }
  if (bits === 0) {
    return true;
  }
  const mask = bits === 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

const BLOCKED_V4_CIDRS = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '255.255.255.255/32',
];

function expandIpv6(ip: string): number[] | null {
  const zoneIndex = ip.indexOf('%');
  const clean = zoneIndex >= 0 ? ip.slice(0, zoneIndex) : ip;
  const halves = clean.split('::');
  if (halves.length > 2) {
    return null;
  }
  const head = (halves[0] ?? '') === '' ? [] : (halves[0] ?? '').split(':');
  const tail = halves.length === 2 && (halves[1] ?? '') !== '' ? (halves[1] ?? '').split(':') : [];
  const expandGroup = (group: string): number[] | null => {
    if (group.includes('.')) {
      const int = ipv4ToInt(group);
      if (int === null) {
        return null;
      }
      return [(int >>> 16) & 0xffff, int & 0xffff];
    }
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) {
      return null;
    }
    return [Number.parseInt(group, 16)];
  };
  const headGroups: number[] = [];
  for (const group of head) {
    const expanded = expandGroup(group);
    if (expanded === null) {
      return null;
    }
    headGroups.push(...expanded);
  }
  const tailGroups: number[] = [];
  for (const group of tail) {
    const expanded = expandGroup(group);
    if (expanded === null) {
      return null;
    }
    tailGroups.push(...expanded);
  }
  if (halves.length === 1) {
    return headGroups.length === 8 ? headGroups : null;
  }
  const missing = 8 - headGroups.length - tailGroups.length;
  if (missing < 1) {
    return null;
  }
  return [...headGroups, ...Array.from({ length: missing }, () => 0), ...tailGroups];
}

function isBlockedV6(groups: number[]): boolean {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
  const isZero = (value: number | undefined): boolean => (value ?? 0) === 0;
  if (groups.every((group) => group === 0)) {
    return true;
  }
  if (
    isZero(g0) &&
    isZero(g1) &&
    isZero(g2) &&
    isZero(g3) &&
    isZero(g4) &&
    isZero(g5) &&
    isZero(g6) &&
    g7 === 1
  ) {
    return true;
  }
  if (g0 === 0xfe80) {
    return true;
  }
  if ((g0 & 0xfe00) === 0xfc00) {
    return true;
  }
  if (g0 === 0xff00 || (g0 & 0xff00) === 0xff00) {
    return true;
  }
  if (
    isZero(g0) &&
    isZero(g1) &&
    isZero(g2) &&
    isZero(g3) &&
    isZero(g4) &&
    (g5 === 0 || g5 === 0xffff)
  ) {
    const dotted = `${(g6 >>> 8) & 0xff}.${g6 & 0xff}.${(g7 >>> 8) & 0xff}.${g7 & 0xff}`;
    const version = isIP(dotted);
    if (version === 4) {
      return classifyIp(dotted) === 'blocked';
    }
    return true;
  }
  if (g0 === 0x2001 && g1 === 0xdb8) {
    return true;
  }
  if (g0 === 0x2001 && g1 === 0) {
    // Teredo (RFC 4380): 2001::/32 embeds an IPv4 address. Block it
    // outright: even a public embedded address must not punch through the
    // allowlist via an IPv6 literal the validator never sees as IPv4.
    return true;
  }
  if (g0 === 0x2002) {
    // 6to4 (RFC 3056): 2002::/16 embeds an IPv4 address. Block the whole
    // range: the embedded address bypasses the IPv4 classification the
    // validator applies to plain A records.
    return true;
  }
  if ((g0 & 0xffc0) === 0xfec0) {
    // Deprecated site-local fec0::/10 (RFC 3879).
    return true;
  }
  if (g0 === 0x64 && g1 === 0xff9b) {
    return true;
  }
  return false;
}

export function classifyIp(address: string): IpClassification {
  const version = isIP(address);
  if (version === 4) {
    for (const cidr of BLOCKED_V4_CIDRS) {
      if (inCidrV4(address, cidr)) {
        return 'blocked';
      }
    }
    return 'public';
  }
  if (version === 6) {
    const groups = expandIpv6(address);
    if (groups === null) {
      return 'blocked';
    }
    return isBlockedV6(groups) ? 'blocked' : 'public';
  }
  return 'blocked';
}

export function isIpLiteral(host: string): boolean {
  return isIP(host) !== 0;
}
