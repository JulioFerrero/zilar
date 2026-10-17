import type { FileBlock as FileBlockData } from '@zilar/protocol';
import { Effect } from 'effect';
import { Download, File } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { Text } from '@/components/ui/text';
import { cardMediaUrl, OPEN_FAILED_MESSAGE } from '@/lib/attachment-common';
import { createAttachmentOpener } from '@/lib/attachment-opener';
import { API_URL } from '@/lib/auth';
import { getSessionToken } from '@/lib/session-token';

// The board's raised tile key (`PhoneContent.dc.html:148`, `.tilekey` at `:26`).
const TILE: ViewStyle = {
  experimental_backgroundImage: 'linear-gradient(180deg, #2c2c2c, #151515)',
  borderWidth: 1,
  borderColor: '#050505',
  boxShadow:
    'inset 0 1px 0 rgba(255,255,255,.16), inset 0 -1px 0 rgba(0,0,0,.65), 0 1px 0 rgba(0,0,0,.95)',
};

// The dark Download key, the same `KEY` as `place-block.tsx:11-16`.
const KEY: ViewStyle = {
  experimental_backgroundImage: 'linear-gradient(180deg, #1c1c1c, #121212)',
  borderWidth: 1,
  borderColor: '#2a2a2a',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.06), 0 2px 6px rgba(0,0,0,.6)',
};

/**
 * 24 · FILE: the file key, the name, a mono `size · format · N rows` line and a
 * 40 px Download key (`PhoneContent.dc.html:144-160`). The bytes are fetched
 * only on tap, through the attachment opener with the session bearer.
 */
export function FileBlock({ block }: { block: FileBlockData }) {
  const opener = useMemo(
    () => createAttachmentOpener({ apiUrl: API_URL, getToken: getSessionToken }),
    [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const meta =
    block.rows === undefined
      ? `${block.size} · ${block.format}`
      : `${block.size} · ${block.format} · ${block.rows} rows`;
  const download = (): void => {
    const url = cardMediaUrl(block.media);
    if (url === undefined || busy) {
      return;
    }
    setBusy(true);
    setError(undefined);
    Effect.runFork(
      Effect.tryPromise(() => opener.open(url, block.name)).pipe(
        Effect.match({
          onSuccess: (result) => {
            setBusy(false);
            setError(result.status === 'error' ? result.message : undefined);
          },
          onFailure: () => {
            setBusy(false);
            setError(OPEN_FAILED_MESSAGE);
          },
        }),
      ),
    );
  };
  return (
    <View className="gap-1.5">
      <View className="flex-row items-center gap-3">
        <View
          className="h-10 w-10 shrink-0 items-center justify-center rounded-[12px]"
          style={TILE}
        >
          <File size={18} color="#d4d4d4" aria-hidden />
        </View>
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="font-medium" numberOfLines={1}>
            {block.name}
          </Text>
          <Text className="font-mono text-[11px] text-[#8a8a8a]" numberOfLines={1}>
            {meta}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Download"
          accessibilityState={{ busy, disabled: busy }}
          disabled={busy}
          onPress={download}
          className="h-10 w-10 shrink-0 items-center justify-center rounded-[12px] active:opacity-80"
          style={KEY}
        >
          {busy ? (
            <ActivityIndicator accessibilityLabel="Downloading" size="small" color="#d4d4d4" />
          ) : (
            <Download size={18} color="#d4d4d4" aria-hidden />
          )}
        </Pressable>
      </View>
      {error === undefined ? null : (
        <Text accessibilityRole="alert" className="text-[12px] text-[#f87171]">
          {error}
        </Text>
      )}
    </View>
  );
}
