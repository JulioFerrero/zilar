import { Effect } from 'effect';
import { Clock, Info } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { ACCENT, MUTED_FOREGROUND } from '@/lib/colors';
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
 * error clear (brief §1). One primary lives in the sticky footer (T-1443):
 * Import on the pick step, Open pack on the result; the terminal states have
 * no footer and only the header's close key.
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
  /** Reloads the My packs list (called when the sheet closes after an import, and on Open pack). */
  onDone: () => void;
  /** Opens the pack editor for the imported pack. */
  onOpenPack: (packId: string) => void;
  api: StickersApi;
  /** Injected in tests so no network is touched. */
  importFn?: (input: string) => Promise<TelegramImportResult>;
}) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<TelegramImportResult | null>(null);
  const [special, setSpecial] = useState<'not-set-up' | 'token-rejected' | null>(null);
  const busyRef = useRef(false);

  const showFailure = (cause: unknown): void => {
    const failure = telegramImportFailure(cause);
    if (failure.kind === 'not-set-up' || failure.kind === 'token-rejected') {
      setResult(null);
      setSpecial(failure.kind);
    } else {
      setError(failure.error);
    }
  };

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
    // The import runs as a fiber; the sheet is updated from its outcome and
    // the busy flag clears on every exit, as the old promise chain did.
    Effect.runFork(
      Effect.tryPromise({ try: () => invoke(rawInput.trim()), catch: (cause) => cause }).pipe(
        Effect.matchEffect({
          onSuccess: (outcome) => Effect.sync(() => setResult(outcome)),
          onFailure: (cause) => Effect.sync(() => showFailure(cause)),
        }),
        Effect.ensuring(
          Effect.sync(() => {
            busyRef.current = false;
            setBusy(false);
          }),
        ),
      ),
    );
  };

  const close = (): void => {
    if (busyRef.current) {
      return;
    }
    // The close key stands in for the removed Done key: once an import has a
    // result, closing reloads My packs through `onDone` as Done used to.
    if (result !== null) {
      onDone();
    }
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

  const footer =
    result !== null ? (
      <View className="flex-row gap-2">
        {result.partial ? (
          <Button
            variant="ghost"
            accessibilityLabel="Import again"
            disabled={busy}
            onPress={() => run(input)}
          >
            <Text>{busy ? 'Importing…' : 'Import again'}</Text>
          </Button>
        ) : null}
        <Button
          className="flex-1"
          accessibilityLabel="Open pack"
          disabled={busy}
          onPress={openPack}
        >
          <Text>Open pack</Text>
        </Button>
      </View>
    ) : special === null ? (
      <Button accessibilityLabel="Import" disabled={busy} onPress={() => run(input)}>
        <Text>{busy ? 'Importing…' : 'Import'}</Text>
      </Button>
    ) : undefined;

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      dismissible={!busy}
      closeLabel="Close Telegram import"
      title={title}
      footer={footer}
    >
      {special === 'not-set-up' ? (
        <View>
          <Text className="mt-1 text-[14px] text-muted-foreground">
            Telegram import is not set up on this server.
          </Text>
          <Text className="mt-1 text-[14px] text-muted-foreground">
            The server owner can turn it on in Settings &gt; Integrations.
          </Text>
        </View>
      ) : special === 'token-rejected' ? (
        <View>
          <Text className="mt-1 text-[14px] text-muted-foreground">
            The Telegram token was rejected. The server owner needs to update it.
          </Text>
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
                <Clock size={14} color={MUTED_FOREGROUND} />
                <Text className="flex-1 text-[14px] text-muted-foreground">
                  The import ran out of time. Run it again to fill in the rest.
                </Text>
              </View>
            ) : null}
            <Text className="text-[13px] text-muted-foreground">
              Imported packs are for personal use. This pack stays private.
            </Text>
          </View>
          {busy ? (
            <View accessibilityLiveRegion="polite" className="mt-3 flex-row items-center gap-2">
              <ActivityIndicator color={ACCENT} />
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
            Paste a pack link (t.me/addstickers/NAME) or the pack name. Only static stickers are
            imported. Animated and video stickers are skipped.
          </Text>
          <Text
            accessibilityLabel="Pack link or name"
            className="mt-3 text-[14px] font-medium text-foreground"
          >
            Pack link or name
          </Text>
          <TextField
            className="mt-3 h-11"
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
            accessibilityLabel="Pack link or name"
          />
          <View className="mt-2 flex-row items-start gap-1.5">
            <Info size={14} color={MUTED_FOREGROUND} />
            <Text className="flex-1 text-[13px] text-muted-foreground">
              Imported packs are for personal use. The pack stays private and cannot be shared with
              the server. Its art belongs to its creators.
            </Text>
          </View>
          {busy ? (
            <View accessibilityLiveRegion="polite" className="mt-3 flex-row items-center gap-2">
              <ActivityIndicator color={ACCENT} />
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
      )}
    </BottomSheet>
  );
}
