import { describe, expect, it } from 'vitest';

import { numberedLines, runStatusText, waitingHosts } from './tool-detail-format';
import type { ToolListItem, ToolRun } from '@/lib/tools-api';

const RUN: ToolRun = {
  id: 'run-1',
  toolId: 'tool-1',
  version: 3,
  trigger: 'manual',
  status: 'ok',
  errorKind: null,
  durationMs: 120,
  fetchCount: 1,
  outputText: 'headlines',
  createdAt: '2026-10-03T09:00:00.000Z',
};

const TOOL: ToolListItem = {
  id: 'tool-1',
  aiId: 'ai-1',
  groupId: null,
  topicId: null,
  name: 'Morning briefing',
  description: 'Fetches the overnight headlines.',
  currentVersion: 3,
  hosts: ['news.example.com', 'api.example.com'],
  approvedHosts: ['news.example.com'],
  lastRunStatus: 'ok',
  updatedAt: '2026-10-03T10:00:00.000Z',
  scope: 'personal',
};

describe('runStatusText', () => {
  it('words an ok run like web', () => {
    expect(runStatusText(RUN)).toContain('ok · v3 · manual · 120 ms ·');
  });

  it('words an error run with its kind', () => {
    expect(runStatusText({ ...RUN, status: 'error', errorKind: 'timeout' })).toContain(
      'error (timeout) · v3 · manual',
    );
  });

  it('reads a missing error kind as failed', () => {
    expect(runStatusText({ ...RUN, status: 'error', errorKind: null })).toContain(
      'error (failed) · v3 · manual',
    );
  });
});

describe('waitingHosts', () => {
  it('returns the hosts nobody approved yet', () => {
    expect(waitingHosts(TOOL)).toEqual(['api.example.com']);
  });

  it('returns nothing when every host is approved', () => {
    expect(
      waitingHosts({ ...TOOL, approvedHosts: ['news.example.com', 'api.example.com'] }),
    ).toEqual([]);
  });

  it('reads missing approvedHosts as none approved', () => {
    const { approvedHosts, ...without } = TOOL;
    void approvedHosts;
    expect(waitingHosts(without)).toEqual(['news.example.com', 'api.example.com']);
  });
});

describe('numberedLines', () => {
  it('numbers each line from one', () => {
    expect(numberedLines('a\nb')).toEqual([
      { n: 1, text: 'a' },
      { n: 2, text: 'b' },
    ]);
  });

  it('reads an empty source as no lines', () => {
    expect(numberedLines('')).toEqual([]);
  });

  it('does not add a line for a trailing newline', () => {
    expect(numberedLines('a\n')).toEqual([{ n: 1, text: 'a' }]);
  });
});
