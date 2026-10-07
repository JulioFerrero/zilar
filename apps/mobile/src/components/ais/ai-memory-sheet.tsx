import { BottomSheet } from '@/components/ui/bottom-sheet';
import type { AiMemoryApi } from '@/lib/ai-memory-api';

import { AiMemorySection } from './ai-memory-section';

/**
 * T-0451: "What <AI> remembers" for a room. Opened from an AI row in the
 * topic info sheet; the section mounts already open for that room's JID,
 * and Forget and Clear follow the server's `canChange`.
 */
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
