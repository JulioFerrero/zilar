import { Effect } from 'effect';
import { File, Paths } from 'expo-file-system';
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
import { EMPTY_MESSAGE, TOO_LARGE_MESSAGE } from '@/lib/attachment-common';
import type { PickedFile } from '@/lib/attachment-ports';
import { MAX_ATTACHMENT_BYTES } from '@/lib/attachments';
import { type ShareDraft, toShareDraft } from '@/lib/share-intent';
import { useChatStore } from '@/store/chat-store-provider';

const SEND_FAILED_MESSAGE = 'Could not send. Try again.';

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

  // A new share starts fresh: the previous pick and error belong to the old draft. Adjusted during render, not in an effect.
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
        // A defect must not leave Send disabled: show the fixed sentence and keep the screen.
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

/**
 * A fixed sentence, never platform text.
 */
const SHARE_COPY_FAILED_MESSAGE = 'Could not read that file. Try again.';

/** A shared `file://` path outside the app cache is refused before anything is sent. */
const SHARE_UNSUPPORTED_MESSAGE = 'That file cannot be shared.';

interface ShareSendStore {
  sendText: (chatId: string, text: string) => void;
  sendAttachment: (chatId: string, file: PickedFile, options?: { caption?: string }) => void;
}

type ShareFileCopy = (file: PickedFile) => Effect.Effect<PickedFile, unknown>;

interface ShareSendDeps {
  copyFile?: ShareFileCopy;
}

type ShareSendResult = { ok: true } | { ok: false; message: string };

const SENT: ShareSendResult = { ok: true };
const COPY_FAILED: ShareSendResult = { ok: false, message: SHARE_COPY_FAILED_MESSAGE };
const UNSUPPORTED: ShareSendResult = { ok: false, message: SHARE_UNSUPPORTED_MESSAGE };
const EMPTY_FILE: ShareSendResult = { ok: false, message: EMPTY_MESSAGE };
const TOO_LARGE_FILE: ShareSendResult = { ok: false, message: TOO_LARGE_MESSAGE };

/**
 * Another app could name a path in Zilar's private files, so `..` segments are refused too and cannot climb out of the cache root.
 */
function isCacheFileUri(uri: string): boolean {
  const root = Paths.cache.uri.endsWith('/') ? Paths.cache.uri : `${Paths.cache.uri}/`;
  if (!uri.startsWith(root)) {
    return false;
  }
  const relative = uri.slice(root.length);
  return relative.length > 0 && !relative.split('/').includes('..');
}

function isShareSourceUri(uri: string): boolean {
  return uri.startsWith('content://') || isCacheFileUri(uri);
}

function shareCacheName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const safe = base.replace(/[^\w.-]+/g, '_').slice(0, 80);
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  return `zilar-share-${unique}-${safe.length > 0 ? safe : 'file'}`;
}

/**
 * The uploader's PUT opens a path directly, so a `content://` uri must be copied first; the real size replaces the sender's, which is often `null`.
 */
const copyIntoCache: ShareFileCopy = Effect.fnUntraced(function* (file: PickedFile) {
  const destination = yield* Effect.try({
    try: () => new File(Paths.cache, shareCacheName(file.name)),
    catch: (error: unknown) => error,
  });
  const source = yield* Effect.try({
    try: () => new File(file.uri),
    catch: (error: unknown) => error,
  });
  yield* Effect.tryPromise({
    try: () => source.copy(destination),
    catch: (error: unknown) => error,
  });
  return { ...file, uri: destination.uri, size: destination.size };
});

/**
 * A `file://` uri is used only inside the app cache, so another app cannot point us at Zilar's own private files; the size rules are checked before any send, so a half-share never arrives. The copies stay in place for the uploader and a retry, since the OS clears the cache.
 */
const sendShare = Effect.fnUntraced(function* (
  chatId: string,
  draft: ShareDraft,
  store: ShareSendStore,
  deps: ShareSendDeps = {},
) {
  const copyFile = deps.copyFile ?? copyIntoCache;
  const files: PickedFile[] = [];

  // Only `content://` and files inside the app cache are ours to read.
  for (const file of draft.files) {
    if (!isShareSourceUri(file.uri)) {
      return UNSUPPORTED;
    }
  }

  for (const file of draft.files) {
    if (!file.uri.startsWith('content://')) {
      files.push(file);
      continue;
    }
    const copied = yield* copyFile(file).pipe(
      Effect.map((result) => ({ ok: true as const, file: result })),
      Effect.catch(() => Effect.succeed({ ok: false as const })),
    );
    if (!copied.ok) {
      return COPY_FAILED;
    }
    files.push(copied.file);
  }

  // Refuse here so the screen shows the reason, not the store after "success".
  for (const file of files) {
    if (file.size === 0) {
      return EMPTY_FILE;
    }
    if (file.size !== undefined && file.size > MAX_ATTACHMENT_BYTES) {
      return TOO_LARGE_FILE;
    }
  }

  if (files.length === 0) {
    if (draft.text !== undefined) {
      store.sendText(chatId, draft.text);
    }
    return SENT;
  }

  files.forEach((file, index) => {
    store.sendAttachment(
      chatId,
      file,
      index === 0 && draft.text !== undefined ? { caption: draft.text } : undefined,
    );
  });
  return SENT;
});
