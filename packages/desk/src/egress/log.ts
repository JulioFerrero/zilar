// effect-plain: the host log is a plain sink plus a small per-desk host list;
// a host daemon, no Effect runtime (like the desk-agent).
/**
 * One line per connection. It carries the time, the desk id, the host, the
 * decision (allowed or denied with a fixed reason code) and the bytes sent back
 * to the client — never a URL, path, header or body (AGENTS.md: audit entries
 * carry ids only; plan §5.3).
 */
export interface EgressLogEntry {
  readonly timestamp: string;
  readonly deskId: string;
  readonly host: string;
  readonly allowed: boolean;
  /** `ok` when allowed, otherwise a fixed decision code such as `blocked-address`. */
  readonly reason: string;
  readonly bytes: number;
}

/** How many recent distinct hosts `hostsFor` keeps per desk. */
export const RECENT_HOSTS_LIMIT = 50;

export interface EgressLogOptions {
  /** Where the JSON lines go; defaults to stderr. */
  readonly write?: (line: string) => void;
  readonly now?: () => number;
  readonly recentLimit?: number;
}

function defaultWrite(line: string): void {
  process.stderr.write(`${line}\n`);
}

export class EgressLog {
  private readonly recent = new Map<string, string[]>();
  private readonly write: (line: string) => void;
  private readonly now: () => number;
  private readonly recentLimit: number;

  constructor(options: EgressLogOptions = {}) {
    this.write = options.write ?? defaultWrite;
    this.now = options.now ?? (() => Date.now());
    this.recentLimit = options.recentLimit ?? RECENT_HOSTS_LIMIT;
  }

  /** Writes one line and remembers the host for `hostsFor`. */
  record(entry: Omit<EgressLogEntry, 'timestamp'>): void {
    const line: EgressLogEntry = {
      timestamp: new Date(this.now()).toISOString(),
      deskId: entry.deskId,
      host: entry.host,
      allowed: entry.allowed,
      reason: entry.reason,
      bytes: entry.bytes,
    };
    this.write(JSON.stringify(line));
    this.remember(entry.deskId, entry.host);
  }

  /** The recent distinct hosts for one desk, most recent first. */
  hostsFor(deskId: string, limit: number = this.recentLimit): readonly string[] {
    return (this.recent.get(deskId) ?? []).slice(0, Math.max(0, limit));
  }

  private remember(deskId: string, host: string): void {
    const hosts = this.recent.get(deskId) ?? [];
    const without = hosts.filter((seen) => seen !== host);
    without.unshift(host);
    this.recent.set(deskId, without.slice(0, this.recentLimit));
  }
}
