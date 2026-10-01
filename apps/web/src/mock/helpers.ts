import type { VoiceMeta } from '@galena/chat-core';
import type { Payload } from '@galena/protocol';
import { AI_JIDS, ROOMS } from './ids';

/** A local date `daysAgo` days back at the given wall-clock time. */
export function atHour(daysAgo: number, hour: number, minute = 0): Date {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, minute, 0, 0);
  return date;
}

export function plusMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

const WAVEFORM_LENGTH = 40;

export function waveform(seed: number, length = WAVEFORM_LENGTH): number[] {
  const bars: number[] = [];
  let state = seed >>> 0;
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    bars.push(25 + (state % 200));
  }
  return bars;
}

export function voice(durationMs: number, seed: number, transcript?: string): VoiceMeta {
  const meta: VoiceMeta = {
    duration_ms: durationMs,
    mime: 'audio/m4a',
    waveform: waveform(seed),
  };
  if (transcript === undefined) {
    return meta;
  }
  return { ...meta, transcript: { text: transcript, language: 'en', source: 'api' } };
}

/** An inline SVG data URI, so mock images never touch the network. */
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
      ai: AI_JIDS.dev1,
      ...(input.taskId === undefined ? {} : { task_id: input.taskId }),
      stage: input.stage,
      ...(input.detail === undefined ? {} : { detail: input.detail }),
      ...(input.percent === undefined ? {} : { percent: input.percent }),
    },
  };
}

export function approvalCard(): Payload {
  return {
    v: 0,
    type: 'approval.request',
    data: {
      id: 'apr-42',
      room: ROOMS.devTeam,
      ai: AI_JIDS.dev1,
      action: 'merge_pull_request',
      summary: 'Merge PR #42 — fix the checkout button on mobile Safari',
      details: 'Squash-merges the branch into main and deletes the branch.',
      args_hash: 'a'.repeat(64),
      worst_case_cost: { currency: 'EUR', amount: 0.4 },
      requested_by: AI_JIDS.dev1,
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    },
  };
}

export interface MockDemoStickerPack {
  id: string;
  title: string;
  stickers: Array<{ id: string; emoji: string; url: string }>;
}

/**
 * Two built-in demo packs for mock mode (T-0120): simple generated stickers
 * served by the mock layer with relative `/api/stickers/:id/file` URLs, so
 * the panel has content with no server and demo stickers send through the
 * same `StickerSchema` validation as real ones.
 *
 * The art is generated SVG, served from the mock layer's file route (not a
 * `data:` URL): the browser only ever loads sticker bytes from the
 * same-origin file path, real or mock.
 */
export function mockDemoStickerPacks(): MockDemoStickerPack[] {
  const pack = (
    id: string,
    title: string,
    cells: Array<[stickerId: string]>,
  ): MockDemoStickerPack => ({
    id,
    title,
    stickers: cells.map(([stickerId], index) => ({
      id: stickerId,
      emoji: ['🐱', '😂', '🔥', '❤️', '🎉', '😎'][index % 6]!,
      url: `/api/stickers/${stickerId}/file`,
    })),
  });
  return [
    pack('11111111-1111-4111-8111-111111111111', 'Cats', [
      ['21111111-1111-4111-8111-111111111111'],
      ['21111111-1111-4111-8111-111111111112'],
      ['21111111-1111-4111-8111-111111111113'],
      ['21111111-1111-4111-8111-111111111114'],
      ['21111111-1111-4111-8111-111111111115'],
      ['21111111-1111-4111-8111-111111111116'],
    ]),
    pack('11111111-1111-4111-8111-111111111222', 'Moods', [
      ['21111111-1111-4111-8111-111111111221'],
      ['21111111-1111-4111-8111-111111111222'],
      ['21111111-1111-4111-8111-111111111223'],
      ['21111111-1111-4111-8111-111111111224'],
      ['21111111-1111-4111-8111-111111111225'],
      ['21111111-1111-4111-8111-111111111226'],
    ]),
  ];
}

/** The generated SVG art behind one demo sticker, keyed by its id. */
export function mockDemoStickerArt(stickerId: string): string | undefined {
  const art: Record<string, [from: string, to: string, glyph: string]> = {
    '21111111-1111-4111-8111-111111111111': ['#fbbf24', '#f97316', '🐱'],
    '21111111-1111-4111-8111-111111111112': ['#a78bfa', '#7c3aed', '😹'],
    '21111111-1111-4111-8111-111111111113': ['#6ee7b7', '#059669', '🙀'],
    '21111111-1111-4111-8111-111111111114': ['#fda4af', '#e11d48', '😻'],
    '21111111-1111-4111-8111-111111111115': ['#7dd3fc', '#0284c7', '🐈'],
    '21111111-1111-4111-8111-111111111116': ['#fde68a', '#d97706', '😺'],
    '21111111-1111-4111-8111-111111111221': ['#fde047', '#ca8a04', '😂'],
    '21111111-1111-4111-8111-111111111222': ['#fca5a5', '#dc2626', '🔥'],
    '21111111-1111-4111-8111-111111111223': ['#c4b5fd', '#6d28d9', '😎'],
    '21111111-1111-4111-8111-111111111224': ['#86efac', '#16a34a', '🎉'],
    '21111111-1111-4111-8111-111111111225': ['#93c5fd', '#1d4ed8', '❤️'],
    '21111111-1111-4111-8111-111111111226': ['#fdba74', '#ea580c', '👍'],
  };
  const cell = art[stickerId];
  if (cell === undefined) {
    return undefined;
  }
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">',
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">',
    `<stop offset="0" stop-color="${cell[0]}"/><stop offset="1" stop-color="${cell[1]}"/>`,
    '</linearGradient></defs>',
    '<rect width="200" height="200" rx="40" fill="url(#g)"/>',
    `<text x="100" y="135" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="88">${cell[2]}</text>`,
    '</svg>',
  ].join('');
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
