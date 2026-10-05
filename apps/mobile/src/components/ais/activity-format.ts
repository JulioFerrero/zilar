import type { PublicAuditEntry } from '@/lib/audit-api';

/**
 * Pure activity descriptions and relative times for the AI activity section
 * (T-0213). Copied from web `apps/web/src/components/ais/AiActivity.tsx`
 * (`describeAuditEntry`, `readDecision`, `humaniseAction`,
 * `formatRelativeAudit`) so the phone shows exactly web's sentences.
 */

export function describeAuditEntry(entry: PublicAuditEntry): string {
  const decision = readDecision(entry.detail);
  switch (entry.action) {
    case 'approval.decided':
      if (decision === 'approve_once' || decision === 'approve_always') {
        return 'A request was approved';
      }
      if (decision === 'deny') {
        return 'A request was denied';
      }
      return 'A request was decided';
    case 'ai.stopped':
      return 'Stopped';
    case 'ai.resumed':
      return 'Resumed';
    default:
      return humaniseAction(entry.action);
  }
}

function readDecision(detail: PublicAuditEntry['detail']): string | null {
  if (detail === null) {
    return null;
  }
  const value = detail['decision'];
  return typeof value === 'string' ? value : null;
}

function humaniseAction(action: string): string {
  if (action === '') {
    return 'Activity';
  }
  const parts = action.split('.');
  const head = parts[0] ?? '';
  const tail = parts.slice(1);
  const capitalised = head === '' ? '' : head.charAt(0).toUpperCase() + head.slice(1);
  return [capitalised, ...tail].join(' ');
}

export function formatRelativeAudit(at: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 60_000));
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}
