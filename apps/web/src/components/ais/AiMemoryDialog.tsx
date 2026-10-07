import { Dialog } from '@/components/ui/dialog';
import { AiMemorySection } from './AiMemorySection';

/**
 * T-0447: the "What <AI> remembers" dialog opened from an AI row in a group
 * or topic panel. It seats the shared AiMemorySection, already expanded.
 */
export function AiMemoryDialog({
  chat,
  aiId,
  aiName,
  onClose,
}: {
  chat: string;
  aiId: string;
  aiName: string;
  onClose: () => void;
}) {
  return (
    <Dialog open onClose={onClose} title={`What ${aiName} remembers`} size="md">
      <AiMemorySection chat={chat} aiId={aiId} aiName={aiName} initiallyOpen />
    </Dialog>
  );
}
