import { Clock, Info, X } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  TextInput,
  View,
} from 'react-native';

import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { ACCENT, ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { well } from '@/lib/depth';
import type { StickersApi, TelegramImportResult } from '@/lib/stickers-api';

import {
  EMPTY_INPUT_ERROR,
  importedCountLine,
  skippedAnimatedLine,
  skippedInvalidLine,
  telegramImportFailure,
} from './telegram-import';

/**
 * The Telegram import bottom sheet (T-0207, the mobile twin of web's
 * `TelegramImportDialog`): paste a pack link or name, run the import, and
 * read the summary. Imported packs stay private for personal use. The parent
 * remounts the sheet on every open (key), so earlier input, result and
 * error clear (brief §1).
 */
export function TelegramImportSheet({
  visible,
  onClose,
  onDone,
  onOpenPack,
  api,
  importFn,
}: {
  visible: boolean;
  /** Closes the sheet. Ignored while an import runs. */
  onClose: () => void;
  /** Reloads the My packs list (called on Done and on Open pack). */
  onDone: () => void;
  /** Opens the pack editor for the imported pack. */
  onOpenPack: (packId: string) => void;
  api: StickersApi;
  /** Injected in tests so no network is touched. */
  importFn?: (input: string) => Promise<TelegramImportResult>;
}) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<TelegramImportResult | null>(null);
  const [special, setSpecial] = useState<'not-set-up' | 'token-rejected' | null>(null);
  const busyRef = useRef(false);

  const run = (rawInput: string): void => {
    if (busyRef.current) {
      return;
    }
    if (rawInput.trim() === '') {
      setError(EMPTY_INPUT_ERROR);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError('');
    const invoke = importFn ?? ((value: string) => api.importTelegramStickers(value));
    void invoke(rawInput.trim())
      .then((outcome) => {
        setResult(outcome);
      })
      .catch((cause: unknown) => {
        const failure = telegramImportFailure(cause);
        if (failure.kind === 'not-set-up' || failure.kind === 'token-rejected') {
          setResult(null);
          setSpecial(failure.kind);
        } else {
          setError(failure.error);
        }
      })
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
      });
  };

  const close = (): void => {
    if (busyRef.current) {
      return;
    }
    onClose();
  };

  const done = (): void => {
    onDone();
    onClose();
  };

  const openPack = (): void => {
    if (result !== null) {
      onDone();
      onOpenPack(result.pack.id);
      onClose();
    }
  };

  const title =
    result !== null
      ? `Imported from Telegram: ${result.pack.title}`
      : special === 'not-set-up'
        ? 'Telegram import is not set up'
        : special === 'token-rejected'
          ? 'The Telegram token was rejected'
          : 'Import from Telegram';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View className="flex-1 justify-end bg-black/40">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss import"
          disabled={busy}
          onPress={close}
          className="flex-1"
        />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View className="rounded-t-2xl bg-background px-4 pb-8 pt-3" style={{ maxHeight: '90%' }}>
            <View className="mb-3 h-1 w-10 self-center rounded-full bg-border-strong" />
            <View className="flex-row items-start justify-between gap-2">
              <Text
                accessibilityRole="header"
                numberOfLines={result !== null ? 2 : undefined}
                className="flex-1 text-[18px] font-semibold text-foreground"
              >
                {title}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                disabled={busy}
                onPress={close}
                className="h-9 w-9 items-center justify-center rounded-lg active:bg-surface-raised disabled:opacity-60"
              >
                <X size={20} color={ICON[scheme]} />
              </Pressable>
            </View>

            {special === 'not-set-up' ? (
              <View>
                <Text className="mt-1 text-[14px] text-muted-foreground">
                  Telegram import is not set up on this server.
                </Text>
                <Text className="mt-1 text-[14px] text-muted-foreground">
                  The server owner can turn it on in Settings &gt; Integrations.
                </Text>
                <View className="mt-4 flex-row justify-end gap-2">
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close"
                    onPress={close}
                    className="rounded-full bg-accent px-5 py-2 active:opacity-90"
                  >
                    <Text className="text-[15px] font-medium text-accent-foreground">Close</Text>
                  </Pressable>
                </View>
              </View>
            ) : special === 'token-rejected' ? (
              <View>
                <Text className="mt-1 text-[14px] text-muted-foreground">
                  The Telegram token was rejected. The server owner needs to update it.
                </Text>
                <View className="mt-4 flex-row justify-end gap-2">
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close"
                    onPress={close}
                    className="rounded-full bg-accent px-5 py-2 active:opacity-90"
                  >
                    <Text className="text-[15px] font-medium text-accent-foreground">Close</Text>
                  </Pressable>
                </View>
              </View>
            ) : result !== null ? (
              <View>
                <View className="mt-3 gap-1.5 rounded-xl border border-border bg-surface p-3">
                  <Text className="text-[15px] text-foreground">
                    {importedCountLine(result.imported)}
                  </Text>
                  {result.skippedAnimated > 0 ? (
                    <Text className="text-[14px] text-muted-foreground">
                      {skippedAnimatedLine(result.skippedAnimated)}
                    </Text>
                  ) : null}
                  {result.skippedInvalid > 0 ? (
                    <Text className="text-[14px] text-muted-foreground">
                      {skippedInvalidLine(result.skippedInvalid)}
                    </Text>
                  ) : null}
                  {result.partial ? (
                    <View className="flex-row items-center gap-1.5">
                      <Clock size={14} color={MUTED_FOREGROUND[scheme]} />
                      <Text className="flex-1 text-[14px] text-muted-foreground">
                        The import ran out of time. Run it again to fill in the rest.
                      </Text>
                    </View>
                  ) : null}
                  <Text className="text-[13px] text-muted-foreground">
                    Imported packs are for personal use. This pack stays private.
                  </Text>
                </View>
                <View className="mt-4 flex-row justify-end gap-2">
                  {result.partial ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Import again"
                      disabled={busy}
                      onPress={() => run(input)}
                      className="rounded-full border border-border-strong px-4 py-2 active:bg-surface-raised disabled:opacity-60"
                    >
                      <Text className="text-[15px] text-foreground">
                        {busy ? 'Importing…' : 'Import again'}
                      </Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Done"
                    disabled={busy}
                    onPress={done}
                    className="rounded-full border border-border-strong px-4 py-2 active:bg-surface-raised disabled:opacity-60"
                  >
                    <Text className="text-[15px] text-foreground">Done</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open pack"
                    disabled={busy}
                    onPress={openPack}
                    className="rounded-full bg-accent px-5 py-2 active:opacity-90 disabled:opacity-60"
                  >
                    <Text className="text-[15px] font-medium text-accent-foreground">
                      Open pack
                    </Text>
                  </Pressable>
                </View>
                {busy ? (
                  <View
                    accessibilityLiveRegion="polite"
                    className="mt-3 flex-row items-center gap-2"
                  >
                    <ActivityIndicator color={ACCENT[scheme]} />
                    <Text className="text-[13px] text-muted-foreground">
                      This can take up to 30 seconds.
                    </Text>
                  </View>
                ) : null}
                {error !== '' ? (
                  <Text accessibilityRole="alert" className="mt-2 text-[14px] text-danger">
                    {error}
                  </Text>
                ) : null}
              </View>
            ) : (
              <View>
                <Text className="mt-1 text-[14px] leading-5 text-muted-foreground">
                  Paste a pack link (t.me/addstickers/NAME) or the pack name. Only static stickers
                  are imported. Animated and video stickers are skipped.
                </Text>
                <Text
                  accessibilityLabel="Pack link or name"
                  className="mt-3 text-[14px] font-medium text-foreground"
                >
                  Pack link or name
                </Text>
                <View className="mt-3 h-11 justify-center rounded-xl px-3" style={well}>
                  <TextInput
                    value={input}
                    onChangeText={setInput}
                    onSubmitEditing={() => run(input)}
                    maxLength={512}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    returnKeyType="go"
                    autoFocus
                    editable={!busy}
                    placeholder="t.me/addstickers/FunCats"
                    placeholderTextColor={MUTED_FOREGROUND[scheme]}
                    accessibilityLabel="Pack link or name"
                    className="text-[15px] text-foreground"
                  />
                </View>
                <View className="mt-2 flex-row items-start gap-1.5">
                  <Info size={14} color={MUTED_FOREGROUND[scheme]} />
                  <Text className="flex-1 text-[13px] text-muted-foreground">
                    Imported packs are for personal use. The pack stays private and cannot be shared
                    with the server. Its art belongs to its creators.
                  </Text>
                </View>
                {busy ? (
                  <View
                    accessibilityLiveRegion="polite"
                    className="mt-3 flex-row items-center gap-2"
                  >
                    <ActivityIndicator color={ACCENT[scheme]} />
                    <Text className="text-[13px] text-muted-foreground">
                      This can take up to 30 seconds.
                    </Text>
                  </View>
                ) : null}
                {error !== '' ? (
                  <Text accessibilityRole="alert" className="mt-2 text-[14px] text-danger">
                    {error}
                  </Text>
                ) : null}
                <View className="mt-4 flex-row justify-end gap-2">
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cancel"
                    disabled={busy}
                    onPress={close}
                    className="rounded-full px-4 py-2 active:bg-surface-raised disabled:opacity-60"
                  >
                    <Text className="text-[15px] text-muted-foreground">Cancel</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Import"
                    disabled={busy}
                    onPress={() => run(input)}
                    className="rounded-full bg-accent px-5 py-2 active:opacity-90 disabled:opacity-60"
                  >
                    <Text className="text-[15px] font-medium text-accent-foreground">
                      {busy ? 'Importing…' : 'Import'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
