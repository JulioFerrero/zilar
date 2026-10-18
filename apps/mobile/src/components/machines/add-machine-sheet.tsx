import * as Clipboard from 'expo-clipboard';
import { Check, Copy } from 'lucide-react-native';
import { Effect } from 'effect';
import { useState } from 'react';
import { View } from 'react-native';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { ACCENT_FOREGROUND } from '@/lib/colors';
import { useAction } from '@/lib/effect/use-action';
import type { PairingCode } from '@/lib/machines-api';
import { MachineCallFailed } from './mutations';

/**
 * The add flow, mirroring web's `AddMachineDialog`: the pairing code and the
 * `zilar-runner pair <CODE>` command. The parent mints the code, so this sheet
 * only renders it; the runner is unpublished, so the sheet says so.
 */
export function AddMachineSheet({
  visible,
  pairing,
  loading,
  error,
  onRetry,
  onClose,
}: {
  visible: boolean;
  pairing: PairingCode | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [, copyCode] = useAction((code: string) =>
    Effect.tryPromise({
      try: () => Clipboard.setStringAsync(code),
      catch: () => new MachineCallFailed({ message: 'Could not copy the code.' }),
    }).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          setCopied(true);
        }),
      ),
    ),
  );

  const copy = (): void => {
    if (pairing === null) {
      return;
    }
    copyCode(pairing.code);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      closeLabel="Close add machine"
      title="Add machine"
      footer={
        !loading && error !== '' ? (
          <Button accessibilityLabel="Try again" onPress={onRetry}>
            <Text>Try again</Text>
          </Button>
        ) : undefined
      }
    >
      <Text className="mt-1 text-[14px] leading-5 text-muted-foreground">
        Pair a new computer where your AIs can work.
      </Text>

      {loading ? <StateMessage kind="loading" title="Creating code…" /> : null}

      {!loading && error !== '' ? (
        <Text accessibilityRole="alert" className="mt-3 text-[14px] text-danger">
          {error}
        </Text>
      ) : null}

      {!loading && error === '' && pairing !== null ? (
        <>
          <View className="mt-3 rounded-xl border border-divider bg-surface px-4 py-3">
            <Text
              selectable
              className="text-center font-mono text-[24px] font-semibold tracking-[0.1em] text-foreground"
            >
              {pairing.code}
            </Text>
            <View className="mt-2 flex-row items-center justify-center">
              <Button
                variant="default"
                size="sm"
                accessibilityLabel="Copy pairing code"
                onPress={copy}
              >
                {copied ? (
                  <Check size={14} color={ACCENT_FOREGROUND} />
                ) : (
                  <Copy size={14} color={ACCENT_FOREGROUND} />
                )}
                <Text>{copied ? 'Copied' : 'Copy'}</Text>
              </Button>
            </View>
          </View>
          <Text className="mt-3 text-[14px] leading-5 text-foreground">
            On the machine, download the runner app, then run{' '}
            <Text className="font-mono text-[13px]">zilar-runner pair {pairing.code}</Text>
          </Text>
          <Text className="mt-1 text-[13px] text-muted-foreground">
            The desktop runner is not published yet — this code is ready for when it is.
          </Text>
        </>
      ) : null}
    </BottomSheet>
  );
}
