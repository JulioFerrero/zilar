import type { Payload } from '@galena/protocol';

import { ApprovalCard } from '@/components/chat/approval-card';
import { ProgressCard } from '@/components/chat/progress-card';

/** Renders the AI card payloads from `@galena/protocol`. */
export function PayloadCard({ card }: { card: Payload }) {
  switch (card.type) {
    case 'progress':
      return <ProgressCard data={card.data} />;
    case 'approval.request':
      return <ApprovalCard data={card.data} />;
    default:
      return null;
  }
}
