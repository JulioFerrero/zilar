import { Effect } from 'effect';
import { useRouter } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { type ReactNode, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LoadingScreen, RequireAuth } from '@/auth/RequireAuth';
import { ChatPickerList } from '@/components/chat/chat-picker-list';
import { Button } from '@/components/ui/button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { sendShare } from '@/lib/share-send';
import { type ShareDraft, toShareDraft } from '@/lib/share-intent';
import { useChatStore } from '@/store/chat-store-provider';

/** Shown when a send ends in a defect rather than a typed result. */
const SEND_FAILED_MESSAGE = 'Could not send. Try again.';

/** The header and frame shared by the draft, error and empty states. */
function ShareFrame({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScreenHeader variant="sub" title="Send to" onBack={onBack} />
      {children}
    </SafeAreaView>
  );
}

/** `3 files · photo.jpg`, or just the count when the sender gave no name. */
function fileSummary(draft: ShareDraft): string | undefined {
  const first = draft.files[0];
  if (first === undefined) {
    return undefined;
  }
  const count = draft.files.length === 1 ? '1 file' : `${draft.files.length} files`;
  return first.name.length > 0 ? `${count} · ${first.name}` : count;
}

/**
 * The `/share` screen (share plan tasks 4 + 6): a share from another app is
 * previewed here, one chat is picked, and only Send sends it. Back or Close
 * resets the share intent and sends nothing.
 */
export default function ShareScreen() {
  return (
    <RequireAuth>
      <ShareToChat />
    </RequireAuth>
  );
}

function ShareToChat() {
  const router = useRouter();
  const chats = useChatStore((state) => state.chats);
  const sendText = useChatStore((state) => state.sendText);
  const sendAttachment = useChatStore((state) => state.sendAttachment);
  const { isReady, hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);

  const parsed = useMemo(
    () => (hasShareIntent ? toShareDraft(shareIntent) : undefined),
    [hasShareIntent, shareIntent],
  );

  // A new share arriving while this screen is open starts fresh: the previous
  // pick and error belong to the old draft. Adjusted during render, as the
  // screens do, not in an effect. `sending` is left alone; an in-flight send
  // re-enables Send itself.
  const [lastShareIntent, setLastShareIntent] = useState(shareIntent);
  if (!Object.is(lastShareIntent, shareIntent)) {
    setLastShareIntent(shareIntent);
    setSelected(undefined);
    setFailure(undefined);
  }

  const leave = (): void => {
    resetShareIntent();
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/');
  };

  const send = (chatId: string, draft: ShareDraft): void => {
    if (sending) {
      return;
    }
    setSending(true);
    setFailure(undefined);
    void Effect.runPromise(
      sendShare(chatId, draft, { sendText, sendAttachment }).pipe(
        // A defect (a thrown path outside the Effect's typed errors) must not
        // leave Send disabled: show the fixed sentence and keep the screen.
        Effect.catchCause(() =>
          Effect.succeed({ ok: false as const, message: SEND_FAILED_MESSAGE }),
        ),
        Effect.tap((result) =>
          Effect.sync(() => {
            if (!result.ok) {
              setFailure(result.message);
              return;
            }
            resetShareIntent();
            router.replace({ pathname: '/chat/[id]', params: { id: chatId } });
          }),
        ),
        Effect.ensuring(Effect.sync(() => setSending(false))),
      ),
    );
  };

  if (!isReady) {
    return <LoadingScreen />;
  }

  const draft = parsed?.ok === true ? parsed.draft : undefined;
  if (draft === undefined) {
    const message =
      failure ??
      (parsed !== undefined && !parsed.ok ? parsed.message : 'There is nothing to share.');
    return (
      <ShareFrame onBack={leave}>
        <View className="flex-1 items-center justify-center gap-4 px-8">
          <Text className="text-center text-[15px] text-muted-foreground">{message}</Text>
          <Button variant="outline" onPress={leave}>
            <Text>Close</Text>
          </Button>
        </View>
      </ShareFrame>
    );
  }

  const summary = fileSummary(draft);
  const toggle = (chatId: string): void => {
    setSelected((current) => (current === chatId ? undefined : chatId));
  };

  return (
    <ShareFrame onBack={leave}>
      <ScrollView className="flex-1 px-4 pt-3" keyboardShouldPersistTaps="handled">
        <View className="rounded-xl border border-divider bg-surface px-3 py-2">
          {draft.text !== undefined ? (
            <Text numberOfLines={3} className="text-[14px] text-foreground">
              {draft.text}
            </Text>
          ) : null}
          {summary !== undefined ? (
            <Text numberOfLines={1} className="mt-1 text-[12px] text-muted-foreground">
              {summary}
            </Text>
          ) : null}
        </View>
        <View className="mt-2">
          <ChatPickerList
            chats={chats}
            selected={selected === undefined ? [] : [selected]}
            onToggle={toggle}
            mode="single"
          />
        </View>
      </ScrollView>
      <View className="border-t border-divider px-4 py-3">
        {failure !== undefined ? (
          <Text accessibilityRole="alert" className="mb-2 text-center text-[13px] text-danger">
            {failure}
          </Text>
        ) : null}
        <Button
          className="w-full"
          disabled={selected === undefined || sending}
          accessibilityLabel="Send"
          onPress={() => {
            if (selected !== undefined) {
              send(selected, draft);
            }
          }}
        >
          <Text>Send</Text>
        </Button>
      </View>
    </ShareFrame>
  );
}
