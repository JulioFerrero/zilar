// Builders for the message seed's non-text content: the waveform and voice
// helpers, the inline-SVG image, and the progress and approval cards the Dev AI
// posts. They mirror `apps/web/src/mock/helpers.ts`, so the demo content is the
// same, and they return protocol `Payload`s the fake XMPP can emit as-is.
import type { Payload } from '@zilar/protocol';
import { JIDS } from './threads/shared';

const WAVEFORM_LENGTH = 40;

/** A deterministic pseudo-random waveform, like the old web mock helper. */
export function waveform(seed: number, length = WAVEFORM_LENGTH): number[] {
  const bars: number[] = [];
  let state = seed >>> 0;
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    bars.push(25 + (state % 200));
  }
  return bars;
}

/** A voice-message payload, with its optional transcript. */
export function voice(durationMs: number, seed: number, transcript?: string): Payload {
  return {
    v: 0,
    type: 'voice',
    data: {
      duration_ms: durationMs,
      mime: 'audio/m4a',
      waveform: waveform(seed),
      ...(transcript === undefined
        ? {}
        : { transcript: { text: transcript, language: 'en', source: 'api' } }),
    },
  };
}

/** An inline SVG data URI, so seed images never touch the network. */
export function svgImage(from: string, to: string, label: string): string {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">',
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">',
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>`,
    '</linearGradient></defs>',
    '<rect width="640" height="420" fill="url(#g)"/>',
    '<circle cx="320" cy="170" r="72" fill="rgba(255,255,255,0.25)"/>',
    `<text x="320" y="330" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="34" font-weight="600">${label}</text>`,
    '</svg>',
  ].join('');
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** An image attachment payload, the real wire shape of the web mock's `image`. */
export function image(from: string, to: string, label: string): Payload {
  return {
    v: 0,
    type: 'attachment',
    data: {
      kind: 'image',
      url: svgImage(from, to, label),
      name: `${label}.png`,
      size: 0,
      mime: 'image/png',
      width: 640,
      height: 420,
    },
  };
}

/** A file attachment payload. */
export function file(url: string, name: string, size: number, mime: string): Payload {
  return { v: 0, type: 'attachment', data: { kind: 'file', url, name, size, mime } };
}

/** A Dev AI progress card. */
export function progressCard(input: {
  stage: string;
  detail?: string;
  percent?: number;
  taskId?: string;
}): Payload {
  return {
    v: 0,
    type: 'progress',
    data: {
      ai: JIDS.dev1,
      ...(input.taskId === undefined ? {} : { task_id: input.taskId }),
      stage: input.stage,
      ...(input.detail === undefined ? {} : { detail: input.detail }),
      ...(input.percent === undefined ? {} : { percent: input.percent }),
    },
  };
}

/** The seeded approval request the Dev AI posts in the Dev team room. */
export function approvalCard(): Payload {
  return {
    v: 0,
    type: 'approval.request',
    data: {
      id: 'apr-42',
      room: 'dev-team@rooms.zilar.test',
      ai: JIDS.dev1,
      action: 'merge_pull_request',
      summary: 'Merge PR #42 — fix the checkout button on mobile Safari',
      details: 'Squash-merges the branch into main and deletes the branch.',
      args_hash: 'a'.repeat(64),
      worst_case_cost: { currency: 'EUR', amount: 0.4 },
      requested_by: JIDS.dev1,
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    },
  };
}
