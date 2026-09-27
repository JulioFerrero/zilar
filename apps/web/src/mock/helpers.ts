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
