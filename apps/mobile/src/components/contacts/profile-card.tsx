import type { ContactRelation } from '@/lib/contacts-api';

/**
 * True when the inline block confirm must be dropped because the card now
 * shows a different person or a different relation. A successful block or
 * unblock changes the relation, so resetting on that keeps the confirm from
 * reopening after an unblock (T-0244 review finding 1).
 */
export function shouldResetBlockConfirm(
  previous: { userId: string; relation: ContactRelation },
  next: { userId: string; relation: ContactRelation },
): boolean {
  return previous.userId !== next.userId || previous.relation !== next.relation;
}
