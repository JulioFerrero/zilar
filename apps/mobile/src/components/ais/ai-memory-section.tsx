import { View } from 'react-native';
import { Brain, Trash2 } from 'lucide-react-native';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import {
  LINE_PREFIX,
  MEMORY_LOAD_FAILED_MESSAGE,
  useAiMemory,
  type AiMemorySectionActions,
  type AiMemorySectionState,
  type makeChatExtrasApi,
} from '@zilar/client-core';

export function AiMemorySectionContent({
  state,
  aiName,
  actions,
  initiallyOpen = false,
}: {
  state: AiMemorySectionState;
  aiName: string;
  actions: AiMemorySectionActions;
  initiallyOpen?: boolean;
}) {
  const { open, status, memory, forgetError, forgettingId, clearError, confirmingClear } = state;
  return (
    <View accessibilityLabel="Memory" className="gap-2 border-t border-divider pt-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-[14px] font-medium">Memory</Text>
        {open && !initiallyOpen ? (
          <Button
            variant="ghost"
            size="sm"
            accessibilityLabel="Hide memory"
            onPress={actions.onHide}
          >
            <Text>Hide memory</Text>
          </Button>
        ) : null}
      </View>

      {!open ? (
        <View className="items-start gap-2">
          <Text className="text-[13px] text-muted-foreground">
            What {aiName} remembers from this chat. It reads this before replying.
          </Text>
          <Button
            variant="ghost"
            size="lg"
            accessibilityLabel="Show memory"
            onPress={actions.onShow}
          >
            <Brain size={16} />
            <Text>Show memory</Text>
          </Button>
        </View>
      ) : null}

      {open && status === 'loading' ? (
        <StateMessage kind="loading" size="inline" title="Loading the memory…" />
      ) : null}

      {open && status === 'error' ? (
        <StateMessage
          kind="error"
          title={MEMORY_LOAD_FAILED_MESSAGE}
          action={{ label: 'Retry', accessibilityLabel: 'Retry', onPress: actions.onRetry }}
        />
      ) : null}

      {open && status === 'ready' && memory !== null ? (
        <>
          <View className="gap-2">
            <Text className="text-[13px] font-medium text-muted-foreground">Pinned facts</Text>
            {forgetError !== '' ? (
              <Text accessibilityRole="alert" className="text-[13px] text-danger">
                {forgetError}
              </Text>
            ) : null}
            {memory.facts.length === 0 ? (
              <Text className="text-[13px] text-muted-foreground">Nothing pinned yet.</Text>
            ) : (
              <View className="gap-1.5">
                {memory.facts.map((fact) => (
                  <View key={fact.id} className="flex-row items-start justify-between gap-2">
                    <Text className="flex-1 text-[13px]">{fact.text}</Text>
                    {memory.canChange ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        accessibilityLabel="Forget this fact"
                        disabled={forgettingId === fact.id}
                        className="h-7 w-7 rounded-full"
                        onPress={() => actions.onForget(fact.id)}
                      >
                        <Trash2 size={16} />
                      </Button>
                    ) : null}
                  </View>
                ))}
              </View>
            )}
          </View>

          <View className="gap-2">
            <Text className="text-[13px] font-medium text-muted-foreground">
              Earlier in this chat
            </Text>
            {memory.lines.length === 0 ? (
              <Text className="text-[13px] text-muted-foreground">
                Nothing older than the recent messages yet.
              </Text>
            ) : (
              <View className="gap-1.5">
                {memory.lines.map((line, index) => (
                  <Text key={index} className="text-[13px] text-muted-foreground">
                    {line.replace(LINE_PREFIX, '')}
                  </Text>
                ))}
              </View>
            )}
          </View>

          {memory.canChange ? (
            <View className="items-start gap-2">
              {clearError !== '' ? (
                <Text accessibilityRole="alert" className="text-[13px] text-danger">
                  {clearError}
                </Text>
              ) : null}
              <Button
                variant="outline"
                size="lg"
                accessibilityLabel="Clear memory"
                onPress={actions.onAskClear}
              >
                <Text className="text-danger">Clear memory</Text>
              </Button>
            </View>
          ) : null}
        </>
      ) : null}

      {open && confirmingClear ? (
        <ConfirmDialog
          visible
          title="Clear memory?"
          message={`${aiName} forgets the pinned facts and the summaries of this chat. The messages stay, and it still reads the recent ones.`}
          confirmLabel="Clear"
          busyLabel="Clearing…"
          busy={false}
          onCancel={actions.onCancelClear}
          onConfirm={actions.onConfirmClear}
          confirmAccessibilityLabel="Clear"
          cancelAccessibilityLabel="Cancel"
          accessibilityLabel="Clear memory"
        />
      ) : null}
    </View>
  );
}

export function AiMemorySection({
  api,
  chat,
  aiId,
  aiName,
  initiallyOpen = false,
}: {
  api: ReturnType<typeof makeChatExtrasApi>;
  chat: string;
  aiId: string;
  aiName: string;
  initiallyOpen?: boolean;
}) {
  const { state, actions } = useAiMemory(api, chat, aiId, initiallyOpen);
  return (
    <AiMemorySectionContent
      aiName={aiName}
      initiallyOpen={initiallyOpen}
      state={state}
      actions={actions}
    />
  );
}
