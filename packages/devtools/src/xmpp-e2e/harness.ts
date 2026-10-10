// Shared helpers for the XMPP end-to-end spike (plan §23, spike S1): config,
// step deadlines and the small stanza utilities.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { xml, type XmppClient, type XmppElement } from '@xmpp/client';
import { loadXmppConfig, type XmppConfig } from '../../../../apps/server/src/xmpp/config';

export const STEP_TIMEOUT_MS = 10_000;

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const envFile = join(repoRoot, 'infra', '.env');

export type Runtime = {
  domain: string;
  websocketUrl: string;
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function loadEnvironment(): XmppConfig {
  if (!existsSync(envFile)) {
    throw new Error(
      `missing ${envFile}. Copy infra/.env.example to infra/.env and fill it in, then run pnpm infra:up`,
    );
  }
  process.loadEnvFile(envFile);
  return loadXmppConfig(process.env);
}

// The admin API URL ends in /api; the XMPP WebSocket lives next to it on /ws.
export function websocketUrlFromApiUrl(apiUrl: string): string {
  const url = new URL(apiUrl);
  const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${url.host}/ws`;
}

export function xmppErrorCondition(stanza: XmppElement): string {
  const condition = stanza.getChild('error')?.getChildElements()[0];
  return condition === undefined ? 'unknown error' : condition.getName();
}

export function collectGroupchat(xmpp: XmppClient, roomJid: string, into: string[]): void {
  xmpp.on('stanza', (stanza: XmppElement) => {
    if (!stanza.is('message') || stanza.attrs['type'] !== 'groupchat') return;
    if (!(stanza.attrs['from'] ?? '').startsWith(`${roomJid}/`)) return;
    const body = stanza.getChildText('body');
    if (body !== null && body !== '') {
      into.push(body);
    }
  });
}

export async function sendGroupchat(
  xmpp: XmppClient,
  roomJid: string,
  id: string,
  body: string,
): Promise<void> {
  await xmpp.send(xml('message', { type: 'groupchat', to: roomJid, id }, xml('body', {}, body)));
}

export async function waitUntil(predicate: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${description}`);
    }
    await sleep(50);
  }
}

export type Deadline<T> = {
  promise: Promise<T>;
  settled: () => boolean;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

// Resolves or rejects once; a timer calls `onTimeout` for the error when nobody
// settles first. Replaces the settled-flag and clearTimeout boilerplate.
export function withDeadline<T>(timeoutMs: number, onTimeout: () => Error): Deadline<T> {
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const settle = (finish: () => void): void => {
    if (settled) return;
    settled = true;
    if (timer !== undefined) clearTimeout(timer);
    finish();
  };

  timer = setTimeout(() => {
    settle(() => rejectPromise(onTimeout()));
  }, timeoutMs);

  return {
    promise,
    settled: () => settled,
    resolve: (value) => settle(() => resolvePromise(value)),
    reject: (error) => settle(() => rejectPromise(error)),
  };
}
