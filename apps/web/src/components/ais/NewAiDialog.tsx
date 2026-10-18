import { useNavigate } from 'react-router';
import type { ChatSummary } from '@zilar/chat-core';
import type { PublicAi } from '@/lib/api';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { DialogStepper } from '../ui/dialog-stepper';
import { KeyStep } from './new-ai/KeyStep';
import { ModelStep } from './new-ai/ModelStep';
import { ProviderStep } from './new-ai/ProviderStep';
import { SetupStep } from './new-ai/SetupStep';
import { useNewAiFlow } from './new-ai/useNewAiFlow';

export function NewAiDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const storeApi = useChatStoreApi();

  const flow = useNewAiFlow({
    onClose,
    onCreated: (created: PublicAi) => {
      const summary: ChatSummary = {
        id: created.jid,
        title: created.name,
        kind: 'dm',
        isAI: true,
        space: 'personal',
        unread: 0,
        muted: false,
        online: false,
        createdAt: new Date(created.createdAt),
      };
      storeApi.setState((state) => ({
        chats: state.chats.some((chat) => chat.id === created.jid)
          ? state.chats
          : [summary, ...state.chats],
      }));
      onClose();
      navigate(`/c/${encodeURIComponent(created.jid)}`);
    },
  });

  return (
    <Dialog
      open
      onClose={flow.close}
      title="New AI"
      size="lg"
      busy={flow.busy}
      stepper={<DialogStepper steps={flow.steps} current={flow.step} onStep={flow.goToStep} />}
      error={flow.error === '' ? undefined : flow.error}
      onSubmit={(event) => {
        event.preventDefault();
        flow.primary();
      }}
      footer={
        <>
          {flow.step > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="key-icon mr-auto text-foreground"
              disabled={flow.busy}
              onClick={flow.back}
            >
              Back
            </Button>
          )}
          <Button type="submit" size="lg" disabled={flow.primaryDisabled}>
            {flow.primaryLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {flow.step === 0 && <ProviderStep keys={flow.keys} />}
        {flow.step === 1 && <KeyStep keys={flow.keys} />}
        {flow.step === 2 && <ModelStep flow={flow} />}
        {flow.step === 3 && <SetupStep flow={flow} />}
      </div>
    </Dialog>
  );
}
