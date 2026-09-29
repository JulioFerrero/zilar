import { describe, expect, it } from 'vitest';
import { runTool } from './run-tool';
import type { HostFetcher } from './host-fetch';

const textEncoder = new TextEncoder();

function jsonFetcher(body: unknown, status = 200): HostFetcher {
  return async () => ({ status, body: textEncoder.encode(JSON.stringify(body)) });
}

function staticResolver(addresses: string[]) {
  return async () => [...addresses];
}

const PUBLIC_RESOLVER = staticResolver(['93.184.216.34']);
const NO_NETWORK_FETCHER: HostFetcher = async () => {
  throw new Error('network touched in a no-network test');
};

describe('runTool happy path', () => {
  it('returns a string as { text }', async () => {
    const result = await runTool({
      source: `export default async function run() { return 'hello'; }`,
      input: null,
      allowedHosts: [],
      fetcher: NO_NETWORK_FETCHER,
    });
    expect(result).toMatchObject({ ok: true, fetchCount: 0 });
    if (result.ok) {
      expect(result.output).toEqual({ text: 'hello' });
    }
  });

  it('returns { text, data } unchanged', async () => {
    const result = await runTool({
      source: `export default async function run() { return { text: 't', data: { n: 1 } }; }`,
      input: null,
      allowedHosts: [],
      fetcher: NO_NETWORK_FETCHER,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toEqual({ text: 't', data: { n: 1 } });
    }
  });

  it('passes input to the function and uses the fake fetch', async () => {
    const result = await runTool({
      source: `export default async function run(input) {
        const res = await fetch('https://api.example.com/price?symbol=BTC');
        const data = await res.json();
        return { text: 'BTC: $' + data.price, data: { price: data.price, echo: input.n } };
      }`,
      input: { n: 7 },
      allowedHosts: ['api.example.com'],
      fetcher: jsonFetcher({ price: 42 }),
      resolver: PUBLIC_RESOLVER,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toEqual({ text: 'BTC: $42', data: { price: 42, echo: 7 } });
      expect(result.fetchCount).toBe(1);
    }
  });

  it('supports res.text()', async () => {
    const result = await runTool({
      source: `export default async function run() {
        const res = await fetch('https://api.example.com/x');
        return await res.text();
      }`,
      input: null,
      allowedHosts: ['api.example.com'],
      fetcher: async () => ({ status: 200, body: textEncoder.encode('plain') }),
      resolver: PUBLIC_RESOLVER,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toEqual({ text: 'plain' });
    }
  });

  it('captures console.log/warn/error', async () => {
    const result = await runTool({
      source: `export default async function run() {
        console.log('a', 1);
        console.warn('b');
        console.error('c');
        return 'done';
      }`,
      input: null,
      allowedHosts: [],
      fetcher: NO_NETWORK_FETCHER,
    });
    expect(result.ok).toBe(true);
    expect(result.logs).toBe('a 1\nb\nc');
  });

  it('defaults input to null', async () => {
    const result = await runTool({
      source: `export default async function run(input) { return 'got:' + String(input); }`,
      allowedHosts: [],
      fetcher: NO_NETWORK_FETCHER,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toEqual({ text: 'got:null' });
    }
  });
});

describe('runTool limits', () => {
  it('times out an infinite loop within the cpu limit', async () => {
    const started = Date.now();
    const result = await runTool({
      source: `export default async function run() { while (true) {} }`,
      input: null,
      allowedHosts: [],
      fetcher: NO_NETWORK_FETCHER,
      limits: { cpuMs: 500, wallMs: 5000 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('timeout');
    }
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('reports memory for an allocation bomb', async () => {
    const result = await runTool({
      source: `export default async function run() { return 'x'.repeat(1e9); }`,
      input: null,
      allowedHosts: [],
      fetcher: NO_NETWORK_FETCHER,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('memory');
    }
  });

  it('reports memory for growing arrays', async () => {
    const result = await runTool({
      source: `export default async function run() {
        const parts = [];
        while (true) { parts.push('x'.repeat(10000)); }
      }`,
      input: null,
      allowedHosts: [],
      fetcher: NO_NETWORK_FETCHER,
      limits: { cpuMs: 5000, wallMs: 15000 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(['memory', 'timeout']).toContain(result.error.kind);
    }
  });

  it('turns deep recursion into a runtime error, not a crash', async () => {
    const result = await runTool({
      source: `export default async function run() { function f() { return f(); } return f(); }`,
      input: null,
      allowedHosts: [],
      fetcher: NO_NETWORK_FETCHER,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('runtime');
      expect(result.error.message).toMatch(/stack overflow/i);
    }
  });

  it('times out a tool that awaits a fetch that never answers', async () => {
    const result = await runTool({
      source: `export default async function run() {
        const res = await fetch('https://api.example.com/slow');
        return await res.text();
      }`,
      input: null,
      allowedHosts: ['api.example.com'],
      fetcher: async () =>
        new Promise(() => undefined) as Promise<{ status: number; body: Uint8Array }>,
      resolver: PUBLIC_RESOLVER,
      limits: { wallMs: 3000, cpuMs: 3000, fetchTimeoutMs: 1000 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(['timeout', 'fetch_denied']).toContain(result.error.kind);
    }
  });

  it('rejects a 2 MiB output', async () => {
    const result = await runTool({
      source: `export default async function run() { return 'y'.repeat(2 * 1024 * 1024); }`,
      input: null,
      allowedHosts: [],
      fetcher: NO_NETWORK_FETCHER,
      limits: { wallMs: 15000 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('output_too_large');
    }
  });

  it('truncates 100 KB of console.log output', async () => {
    const result = await runTool({
      source: `export default async function run() {
        for (let i = 0; i < 2000; i++) { console.log('line-' + i + '-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'); }
        return 'done';
      }`,
      input: null,
      allowedHosts: [],
      fetcher: NO_NETWORK_FETCHER,
    });
    expect(result.ok).toBe(true);
    expect(Buffer.byteLength(result.logs, 'utf8')).toBeLessThanOrEqual(4 * 1024 + 64);
    expect(result.logs.endsWith('…')).toBe(true);
  });

  it('denies the 6th fetch', async () => {
    const result = await runTool({
      source: `export default async function run() {
        for (let i = 0; i < 6; i++) { await fetch('https://api.example.com/x'); }
        return 'done';
      }`,
      input: null,
      allowedHosts: ['api.example.com'],
      fetcher: jsonFetcher({ ok: true }),
      resolver: PUBLIC_RESOLVER,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('fetch_denied');
      expect(result.fetchCount).toBe(5);
    }
  });

  it('rejects a 65 KiB source without starting the VM', async () => {
    const result = await runTool({
      source: `export default async function run() { return 1; } // ${'x'.repeat(66 * 1024)}`,
      input: null,
      allowedHosts: [],
      fetcher: NO_NETWORK_FETCHER,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'invalid_source' },
      fetchCount: 0,
    });
  });
});

describe('runTool contract errors', () => {
  it('maps a syntax error to syntax', async () => {
    const result = await runTool({
      source: `export default async function run( { oops }`,
      input: null,
      allowedHosts: [],
      fetcher: NO_NETWORK_FETCHER,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('syntax');
    }
  });

  it('requires a default-exported function', async () => {
    for (const source of [`export const x = 1;`, `export default 42;`, `export default 'run';`]) {
      const result = await runTool({
        source,
        input: null,
        allowedHosts: [],
        fetcher: NO_NETWORK_FETCHER,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('invalid_output');
      }
    }
  });

  it.each([
    ['number', `export default async function run() { return 42; }`],
    ['undefined', `export default async function run() {}`],
    ['function', `export default async function run() { return function () {}; }`],
    ['circular', `export default async function run() { const o = {}; o.self = o; return o; }`],
    ['missing text', `export default async function run() { return { data: 1 }; }`],
  ])('rejects %s as invalid_output', async (_name, source) => {
    const result = await runTool({
      source,
      input: null,
      allowedHosts: [],
      fetcher: NO_NETWORK_FETCHER,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid_output');
    }
  });

  it('maps a thrown error to runtime with the message but no host paths', async () => {
    const result = await runTool({
      source: `export default async function run() { throw new Error('boom'); }`,
      input: null,
      allowedHosts: [],
      fetcher: NO_NETWORK_FETCHER,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('runtime');
      expect(result.error.message).toContain('boom');
      expect(result.error.message).not.toMatch(/\/app|\/home|[A-Z]:\\/);
    }
  });

  it('maps a rejected promise to runtime', async () => {
    const result = await runTool({
      source: `export default async function run() { return Promise.reject(new Error('nope')); }`,
      input: null,
      allowedHosts: [],
      fetcher: NO_NETWORK_FETCHER,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('runtime');
      expect(result.error.message).toContain('nope');
    }
  });
});

describe('runTool escape attempts', () => {
  it('exposes no host globals', async () => {
    const result = await runTool({
      source: `export default async function run() {
        return [
          typeof process,
          typeof require,
          typeof globalThis.Buffer,
          typeof globalThis.process,
        ].join(',');
      }`,
      input: null,
      allowedHosts: [],
      fetcher: NO_NETWORK_FETCHER,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toEqual({ text: 'undefined,undefined,undefined,undefined' });
    }
  });

  it('rejects a static import of node:fs', async () => {
    const result = await runTool({
      source: `import fs from 'node:fs';\nexport default async function run() { return 'x'; }`,
      input: null,
      allowedHosts: [],
      fetcher: NO_NETWORK_FETCHER,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(['runtime', 'syntax']).toContain(result.error.kind);
      expect(result.error.message).toMatch(/import/i);
    }
  });

  it('rejects a dynamic import of node:fs', async () => {
    const result = await runTool({
      source: `export default async function run() { const m = await import('node:fs'); return 'loaded'; }`,
      input: null,
      allowedHosts: [],
      fetcher: NO_NETWORK_FETCHER,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('runtime');
      expect(result.error.message).toMatch(/could not load module/i);
    }
  });

  it('contains Function-constructor escapes inside the VM', async () => {
    const result = await runTool({
      source: `export default async function run() {
        const f = Function('return 42')();
        const AsyncFunction = (async () => {}).constructor;
        const g = await new AsyncFunction('return 43')();
        const probe = typeof process;
        return '' + f + ',' + g + ',' + probe;
      }`,
      input: null,
      allowedHosts: [],
      fetcher: NO_NETWORK_FETCHER,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toEqual({ text: '42,43,undefined' });
    }
  });

  it('gives the async-function constructor no host access', async () => {
    const result = await runTool({
      source: `export default async function run() {
        const AsyncFunction = (async () => {}).constructor;
        const f = new AsyncFunction('return typeof process');
        return await f();
      }`,
      input: null,
      allowedHosts: [],
      fetcher: NO_NETWORK_FETCHER,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toEqual({ text: 'undefined' });
    }
  });

  it('does not leak prototype pollution into a second run', async () => {
    const pollute = await runTool({
      source: `export default async function run() {
        Object.defineProperty(Object.prototype, 'galenaPolluted', { value: 1, configurable: true });
        return ({}).galenaPolluted === 1 ? 'polluted' : 'clean';
      }`,
      input: null,
      allowedHosts: [],
      fetcher: NO_NETWORK_FETCHER,
    });
    expect(pollute.ok).toBe(true);
    const second = await runTool({
      source: `export default async function run() { return 'seen:' + String({}).galenaPolluted; }`,
      input: null,
      allowedHosts: [],
      fetcher: NO_NETWORK_FETCHER,
    });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.output).toEqual({ text: 'seen:undefined' });
    }
  });

  it('lists only allowed globals plus JS built-ins on globalThis', async () => {
    const result = await runTool({
      source: `export default async function run() {
        const names = Object.getOwnPropertyNames(globalThis);
        const bad = names.filter((n) => ['process', 'require', 'Buffer', 'setTimeout', 'setInterval', 'fetch'].includes(n) && n !== 'fetch' && n !== 'console');
        const leaked = ['process', 'require', 'Buffer', 'setTimeout', 'setInterval', 'TextEncoder', 'crypto', 'ReadableStream'].filter((n) => names.includes(n));
        return JSON.stringify({ hasFetch: names.includes('fetch'), hasConsole: names.includes('console'), bad, leaked });
      }`,
      input: null,
      allowedHosts: [],
      fetcher: NO_NETWORK_FETCHER,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const parsed = JSON.parse(result.output.text) as {
        hasFetch: boolean;
        hasConsole: boolean;
        bad: string[];
        leaked: string[];
      };
      expect(parsed.hasFetch).toBe(true);
      expect(parsed.hasConsole).toBe(true);
      expect(parsed.bad).toEqual([]);
      expect(parsed.leaked).toEqual([]);
    }
  });
});

describe('runTool fetch rules', () => {
  it('rejects a host outside the allowlist without calling the fetcher', async () => {
    let called = 0;
    const result = await runTool({
      source: `export default async function run() { await fetch('https://evil.com/x'); return 'got'; }`,
      input: null,
      allowedHosts: ['api.example.com'],
      fetcher: async () => {
        called += 1;
        return { status: 200, body: new Uint8Array(0) };
      },
      resolver: PUBLIC_RESOLVER,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('fetch_denied');
      expect(result.error.message).toMatch(/host not allowed: evil\.com/);
    }
    expect(called).toBe(0);
  });

  it('rejects http, credentials, ports and unlisted hosts', async () => {
    const cases: Array<[string, RegExp]> = [
      [
        `export default async function run() { await fetch('http://api.example.com/x'); return 'x'; }`,
        /only https/,
      ],
      [
        `export default async function run() { await fetch('https://u:p@api.example.com/x'); return 'x'; }`,
        /credentials/,
      ],
      [
        `export default async function run() { await fetch('https://api.example.com:8443/x'); return 'x'; }`,
        /port/,
      ],
    ];
    for (const [source, pattern] of cases) {
      const result = await runTool({
        source,
        input: null,
        allowedHosts: ['api.example.com'],
        fetcher: NO_NETWORK_FETCHER,
        resolver: PUBLIC_RESOLVER,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('fetch_denied');
        expect(result.error.message).toMatch(pattern);
      }
    }
  });

  it.each(['127.0.0.1', '10.0.0.5', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fd00::1'])(
    'blocks a listed host resolving to %s',
    async (address) => {
      const result = await runTool({
        source: `export default async function run() { await fetch('https://api.example.com/x'); return 'x'; }`,
        input: null,
        allowedHosts: ['api.example.com'],
        fetcher: NO_NETWORK_FETCHER,
        resolver: staticResolver([address]),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('fetch_denied');
      }
    },
  );

  it('blocks mixed public/private answers and IP literals', async () => {
    const mixed = await runTool({
      source: `export default async function run() { await fetch('https://api.example.com/x'); return 'x'; }`,
      input: null,
      allowedHosts: ['api.example.com'],
      fetcher: NO_NETWORK_FETCHER,
      resolver: staticResolver(['93.184.216.34', '10.0.0.5']),
    });
    expect(mixed.ok).toBe(false);

    const literal = await runTool({
      source: `export default async function run() { await fetch('https://93.184.216.34/x'); return 'x'; }`,
      input: null,
      allowedHosts: ['93.184.216.34', 'api.example.com'],
      fetcher: NO_NETWORK_FETCHER,
      resolver: PUBLIC_RESOLVER,
    });
    expect(literal.ok).toBe(false);
  });

  it('normalises mixed-case and punycode hosts', async () => {
    const seen: string[] = [];
    const mixed = await runTool({
      source: `export default async function run() { await fetch('https://API.Example.COM/x'); return 'ok'; }`,
      input: null,
      allowedHosts: ['api.example.com'],
      fetcher: async (request) => {
        seen.push(request.url.hostname);
        return { status: 200, body: textEncoder.encode('{}') };
      },
      resolver: PUBLIC_RESOLVER,
    });
    expect(mixed.ok).toBe(true);
    expect(seen).toEqual(['api.example.com']);
    const trailingDot = await runTool({
      source: `export default async function run() { await fetch('https://API.Example.COM./x'); return 'ok'; }`,
      input: null,
      allowedHosts: ['api.example.com'],
      fetcher: async (request) => {
        seen.push(request.url.hostname);
        return { status: 200, body: textEncoder.encode('{}') };
      },
      resolver: PUBLIC_RESOLVER,
    });
    expect(trailingDot.ok).toBe(true);
    const puny = await runTool({
      source: `export default async function run() { await fetch('https://xn--mnchen-3ya.de/x'); return 'ok'; }`,
      input: null,
      allowedHosts: ['münchen.de'],
      fetcher: async (request) => {
        seen.push(request.url.hostname);
        return { status: 200, body: textEncoder.encode('{}') };
      },
      resolver: PUBLIC_RESOLVER,
    });
    expect(puny.ok).toBe(true);
  });

  it('does not follow a 302 and exposes no location header', async () => {
    const result = await runTool({
      source: `export default async function run() {
        const res = await fetch('https://api.example.com/old');
        const body = await res.text();
        return res.status + ':' + res.ok + ':' + body + ':' + typeof res.headers;
      }`,
      input: null,
      allowedHosts: ['api.example.com'],
      fetcher: async () => ({ status: 302, body: new Uint8Array(0) }),
      resolver: PUBLIC_RESOLVER,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toEqual({ text: '302:false::undefined' });
    }
  });

  it('refuses POST/PUT and bodies, and drops disallowed headers', async () => {
    const calls: Array<{ url: URL; address: string }> = [];
    const post = await runTool({
      source: `export default async function run() {
        await fetch('https://api.example.com/x', { method: 'POST', body: 'hi' });
        return 'x';
      }`,
      input: null,
      allowedHosts: ['api.example.com'],
      fetcher: async (request) => {
        calls.push(request);
        return { status: 200, body: new Uint8Array(0) };
      },
      resolver: PUBLIC_RESOLVER,
    });
    expect(post.ok).toBe(false);
    if (!post.ok) {
      expect(post.error.kind).toBe('fetch_denied');
    }
    expect(calls).toHaveLength(0);
  });

  it('refuses a response over the cap', async () => {
    const result = await runTool({
      source: `export default async function run() {
        const res = await fetch('https://api.example.com/big');
        return await res.text();
      }`,
      input: null,
      allowedHosts: ['api.example.com'],
      fetcher: async () => ({ status: 200, body: new Uint8Array(2 * 1024 * 1024) }),
      resolver: PUBLIC_RESOLVER,
      limits: { maxResponseBytes: 1024 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('fetch_denied');
      expect(result.error.message).toMatch(/too large/);
    }
  });

  it('pins the validated IP even if DNS changes (rebinding)', async () => {
    const seen: string[] = [];
    let calls = 0;
    const result = await runTool({
      source: `export default async function run() {
        const res = await fetch('https://api.example.com/x');
        return await res.text();
      }`,
      input: null,
      allowedHosts: ['api.example.com'],
      fetcher: async (request) => {
        seen.push(request.address);
        return { status: 200, body: textEncoder.encode('ok') };
      },
      resolver: async () => {
        calls += 1;
        return calls === 1 ? ['93.184.216.34'] : ['127.0.0.1'];
      },
    });
    expect(result.ok).toBe(true);
    expect(seen).toEqual(['93.184.216.34']);
    expect(calls).toBe(1);
  });

  it('clamps limits to the hard maxima', async () => {
    const result = await runTool({
      source: `export default async function run() { return 'x'; }`,
      input: null,
      allowedHosts: [],
      fetcher: NO_NETWORK_FETCHER,
      limits: { wallMs: 120_000, memoryBytes: 512 * 1024 * 1024, maxFetches: 100 },
    });
    expect(result.ok).toBe(true);
  });
});
