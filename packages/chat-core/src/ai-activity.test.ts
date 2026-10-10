import { describe, expect, it } from 'vitest';

import { describeAuditEntry, formatRelativeAudit, type AuditEntryLike } from './ai-activity';

function entry(action: string, detail: Record<string, unknown> | null): AuditEntryLike {
  return { action, detail };
}

describe('describeAuditEntry', () => {
  it('approves approve_once and approve_always', () => {
    expect(describeAuditEntry(entry('approval.decided', { decision: 'approve_once' }))).toBe(
      'A request was approved',
    );
    expect(describeAuditEntry(entry('approval.decided', { decision: 'approve_always' }))).toBe(
      'A request was approved',
    );
  });

  it('denies deny', () => {
    expect(describeAuditEntry(entry('approval.decided', { decision: 'deny' }))).toBe(
      'A request was denied',
    );
  });

  it('reads any other decision as decided', () => {
    expect(describeAuditEntry(entry('approval.decided', null))).toBe('A request was decided');
    expect(describeAuditEntry(entry('approval.decided', {}))).toBe('A request was decided');
    expect(describeAuditEntry(entry('approval.decided', { decision: 'needs_changes' }))).toBe(
      'A request was decided',
    );
    expect(describeAuditEntry(entry('approval.decided', { decision: 42 }))).toBe(
      'A request was decided',
    );
  });

  it('names stops and resumes', () => {
    expect(describeAuditEntry(entry('ai.stopped', null))).toBe('Stopped');
    expect(describeAuditEntry(entry('ai.resumed', null))).toBe('Resumed');
  });

  it('humanises any other action', () => {
    expect(describeAuditEntry(entry('tool.run', null))).toBe('Tool run');
    expect(describeAuditEntry(entry('routine.created', null))).toBe('Routine created');
    expect(describeAuditEntry(entry('message.sent', null))).toBe('Message sent');
  });

  it('falls back to Activity for an empty action', () => {
    expect(describeAuditEntry(entry('', null))).toBe('Activity');
  });
});

describe('formatRelativeAudit', () => {
  const now = new Date('2026-10-03T10:00:00.000Z');
  const ago = (minutes: number): Date => new Date(now.getTime() - minutes * 60_000);

  it('says just now under a minute', () => {
    expect(formatRelativeAudit(now, now)).toBe('just now');
    expect(formatRelativeAudit(ago(0.5), now)).toBe('just now');
  });

  it('counts minutes under an hour', () => {
    expect(formatRelativeAudit(ago(1), now)).toBe('1 min ago');
    expect(formatRelativeAudit(ago(59), now)).toBe('59 min ago');
  });

  it('counts hours under a day, singular and plural', () => {
    expect(formatRelativeAudit(ago(60), now)).toBe('1 hour ago');
    expect(formatRelativeAudit(ago(120), now)).toBe('2 hours ago');
    expect(formatRelativeAudit(ago(23 * 60), now)).toBe('23 hours ago');
  });

  it('counts days, singular and plural', () => {
    expect(formatRelativeAudit(ago(24 * 60), now)).toBe('1 day ago');
    expect(formatRelativeAudit(ago(2 * 24 * 60), now)).toBe('2 days ago');
  });

  it('clamps future times to just now', () => {
    expect(formatRelativeAudit(new Date(now.getTime() + 60_000), now)).toBe('just now');
  });
});
