import type { ContactRelation } from '@/lib/contacts-api';

/**
 * True when the inline block confirm must be dropped because the card shows a
 * different person or relation: a successful block or unblock changes the
 * relation, so resetting on that keeps the confirm from reopening.
 */
export function shouldResetBlockConfirm(
  previous: { userId: string; relation: ContactRelation },
  next: { userId: string; relation: ContactRelation },
): boolean {
  return previous.userId !== next.userId || previous.relation !== next.relation;
}
