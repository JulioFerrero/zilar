import * as Clipboard from 'expo-clipboard';
import { Check, Copy } from 'lucide-react-native';
import { Effect } from 'effect';
import { useState } from 'react';
import { Modal, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { ACCENT_FOREGROUND } from '@/lib/colors';
import { useAction } from '@/lib/effect/use-action';
import type { PairingCode } from '@/lib/machines-api';
import { MachineCallFailed } from './mutations';

/**
 * The add flow (mirrors web's `AddMachineDialog`): shows the pairing code
 * big with a Copy button and the `zilar-runner pair <CODE>` command. The
 * code is minted by the parent's "Add machine" tap, so this sheet only
 * renders the result. The desktop runner is not published yet, so the sheet
 * says so honestly, exactly like web.
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/40 p-6">
        <View className="w-full max-w-xs rounded-2xl border border-border-strong bg-surface p-4">
          <Text className="text-[16px] font-semibold text-foreground">Add machine</Text>
          <Text className="mt-1 text-[14px] leading-5 text-muted-foreground">
            Pair a new computer where your AIs can work.
          </Text>

          {loading ? <StateMessage kind="loading" title="Creating code…" /> : null}

          {!loading && error !== '' ? (
            <>
              <Text accessibilityRole="alert" className="mt-3 text-[14px] text-danger">
                {error}
              </Text>
              <View className="mt-4 flex-row justify-end gap-2">
                <Button variant="ghost" size="sm" accessibilityLabel="Close" onPress={onClose}>
                  <Text>Close</Text>
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  accessibilityLabel="Try again"
                  onPress={onRetry}
                >
                  <Text>Try again</Text>
                </Button>
              </View>
            </>
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
              <View className="mt-4 flex-row justify-end">
                <Button variant="default" size="sm" accessibilityLabel="Done" onPress={onClose}>
                  <Text>Done</Text>
                </Button>
              </View>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
