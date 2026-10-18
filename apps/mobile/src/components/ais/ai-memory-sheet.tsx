import { BottomSheet } from '@/components/ui/bottom-sheet';
import type { AiMemoryApi } from '@/lib/ai-memory-api';

import { AiMemorySection } from './ai-memory-section';

/** Forget and Clear follow the server's `canChange`. */
export function AiMemorySheet({
  api,
  chat,
  ai,
  onClose,
}: {
  api: AiMemoryApi;
  chat: string;
  ai: { id: string; name: string } | null;
  onClose: () => void;
}) {
  return (
    <BottomSheet
      visible={ai !== null}
      onClose={onClose}
      closeLabel="Close memory"
      title={ai !== null ? `What ${ai.name} remembers` : undefined}
    >
      {ai !== null ? (
        <AiMemorySection api={api} chat={chat} aiId={ai.id} aiName={ai.name} initiallyOpen />
      ) : null}
    </BottomSheet>
  );
}
