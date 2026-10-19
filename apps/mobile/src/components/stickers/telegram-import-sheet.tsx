import { Effect } from 'effect';
import { Clock, Info } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { ApiError } from '@zilar/api-contract';
import type { TelegramImportResult } from '@zilar/client-core';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Text, TextField } from '@/components/ui/text';
import { ACCENT, MUTED_FOREGROUND } from '@/lib/colors';
import type { StickersApi } from '@/lib/stickers-api';

/**
 * The pure parts of the Telegram import sheet: the error-to-state mapping and
 * the count sentences, tested without rendering.
 */

const EMPTY_INPUT_ERROR = 'Paste a pack link or name first.';
const INVALID_LINK_ERROR = 'That does not look like a Telegram sticker pack link or name.';
const PACK_NOT_FOUND_ERROR = 'That Telegram sticker pack was not found.';
const CUSTOM_EMOJI_ERROR = 'Custom emoji sets cannot be imported as sticker packs.';
const TRY_LATER_ERROR = 'Telegram is busy. Try again later.';
const RATE_LIMITED_ERROR = 'Too many imports. Try again in an hour.';
const PACK_LIMIT_ERROR = 'You have reached the limit of 100 packs.';
const GENERIC_IMPORT_ERROR = 'The import failed. Try again.';

type TelegramImportSheetState =
  { kind: 'form'; error: string } | { kind: 'not-set-up' } | { kind: 'token-rejected' };

/** Maps an import failure to its sheet state (never server text). */
function telegramImportFailure(error: unknown): TelegramImportSheetState {
  if (error instanceof ApiError) {
    if (error.status === 501 || error.code === 'import_unavailable') {
      return { kind: 'not-set-up' };
    }
    if (error.code === 'token_invalid') {
      return { kind: 'token-rejected' };
    }
    if (error.status === 429 || error.code === 'rate_limited') {
      return { kind: 'form', error: RATE_LIMITED_ERROR };
    }
    switch (error.code) {
      case 'invalid_request':
        return { kind: 'form', error: INVALID_LINK_ERROR };
      case 'pack_not_found':
        return { kind: 'form', error: PACK_NOT_FOUND_ERROR };
      case 'custom_emoji_unsupported':
        return { kind: 'form', error: CUSTOM_EMOJI_ERROR };
      case 'try_later':
        return { kind: 'form', error: TRY_LATER_ERROR };
      case 'pack_limit':
        return { kind: 'form', error: PACK_LIMIT_ERROR };
      default:
        return { kind: 'form', error: GENERIC_IMPORT_ERROR };
    }
  }
  return { kind: 'form', error: GENERIC_IMPORT_ERROR };
}

function importedCountLine(imported: number): string {
  return imported === 1 ? '1 sticker added' : `${imported} stickers added`;
}

function skippedAnimatedLine(skippedAnimated: number): string {
  return skippedAnimated === 1
    ? '1 animated sticker was skipped'
    : `${skippedAnimated} animated stickers were skipped`;
}

function skippedInvalidLine(skippedInvalid: number): string {
  return skippedInvalid === 1
    ? '1 file was skipped as invalid'
    : `${skippedInvalid} files were skipped as invalid`;
}

export function TelegramImportSheet({
  visible,
  onClose,
  onDone,
  onOpenPack,
  api,
  importFn,
}: {
  visible: boolean;
  onClose: () => void;
  onDone: () => void;
  onOpenPack: (packId: string) => void;
  api: StickersApi;
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

  const progress = (
    <>
      {busy ? (
        <View accessibilityLiveRegion="polite" className="mt-3 flex-row items-center gap-2">
          <ActivityIndicator color={ACCENT} />
          <Text className="text-[13px] text-muted-foreground">This can take up to 30 seconds.</Text>
        </View>
      ) : null}
      {error !== '' ? (
        <Text accessibilityRole="alert" className="mt-2 text-[14px] text-danger">
          {error}
        </Text>
      ) : null}
    </>
  );

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
          {progress}
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
          {progress}
        </View>
      )}
    </BottomSheet>
  );
}
