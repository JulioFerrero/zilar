import { formatFileSize } from '@zilar/chat-core';
import { Download } from 'lucide-react-native';
import { useState } from 'react';
import { Modal, Platform, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { IconTile } from '@/components/ui/icon-tile';
import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';
import { useAppUpdate, type AppUpdate } from '@/lib/use-app-update';

/** The mono detail line: `0.2.3 → 0.2.4 · 67 MB`, or the version and size alone. */
export function versionLine(installed: string | null, version: string, sizeBytes: number): string {
  const size = formatFileSize(sizeBytes);
  return installed === null ? `${version} · ${size}` : `${installed} → ${version} · ${size}`;
}

/** The download line: `41 of 67 MB`. */
export function progressLine(progress: number, total: number): string {
  const clamped = Math.max(0, Math.min(1, progress));
  return `${formatFileSize(Math.round(clamped * total))} of ${formatFileSize(total)}`;
}

/** The recessed progress well: 8 px, a 1 px border and an accent fill. */
function ProgressWell({ progress }: { progress: number }) {
  const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`Download progress ${percent} percent`}
      className="h-2 overflow-hidden rounded-full border border-border bg-well"
    >
      <View className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
    </View>
  );
}

interface DialogContent {
  title: string;
  detail: string | null;
  message?: string;
  error?: string;
  progress?: number;
  dismiss: { label: string; onPress: () => void };
  primary?: { label: string; onPress: () => void };
  accessibilityLabel: string;
}

/** The visible parts of the last prompt, kept so a failure can still name it. */
type PromptContext = Pick<DialogContent, 'title' | 'detail' | 'message' | 'progress'>;

function promptContext(content: DialogContent): PromptContext {
  const { title, detail, message, progress } = content;
  return { title, detail, message, progress };
}

/** Deep-equals the fields a `PromptContext` keeps (the actions are not stored). */
function samePrompt(a: PromptContext | null, b: PromptContext | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return (
    a.title === b.title &&
    a.detail === b.detail &&
    a.message === b.message &&
    a.progress === b.progress
  );
}

/** The prompt for one updater state, or `null` when no dialog should show. */
function contentFor(update: AppUpdate): DialogContent | null {
  const { state, installed, later, download, install, cancel } = update;
  switch (state.status) {
    case 'available':
      return {
        title: `Update to Zilar ${state.version}`,
        detail: versionLine(installed, state.version, state.sizeBytes),
        message: "You're on mobile data. Download now?",
        dismiss: { label: 'Later', onPress: later },
        primary: { label: 'Download', onPress: download },
        accessibilityLabel: 'Update available',
      };
    case 'downloading':
      if (state.quiet) {
        return null;
      }
      return {
        title: `Downloading ${state.version}`,
        detail: progressLine(state.progress, state.sizeBytes),
        progress: state.progress,
        dismiss: { label: 'Cancel', onPress: cancel },
        accessibilityLabel: 'Downloading update',
      };
    case 'ready':
      return {
        title: `Zilar ${state.version} is ready`,
        detail: versionLine(installed, state.version, state.sizeBytes),
        message: 'Install now? Your chats stay as they are.',
        dismiss: { label: 'Later', onPress: later },
        primary: { label: 'Install', onPress: install },
        accessibilityLabel: 'Update ready',
      };
    default:
      return null;
  }
}

/**
 * The failure prompt: the last prompt's content, so it still names the version,
 * plus the alert line. With no prompt to keep (e.g. a check that failed while
 * nothing was offered) it falls back to a generic "Update failed" title.
 */
function failedContent(
  last: PromptContext | null,
  message: string,
  onDismiss: () => void,
  onRetry: () => void,
): DialogContent {
  return {
    title: last?.title ?? 'Update failed',
    detail: last?.detail ?? null,
    message: last?.message,
    progress: last?.progress,
    error: message,
    dismiss: { label: 'Later', onPress: onDismiss },
    primary: { label: 'Try again', onPress: onRetry },
    accessibilityLabel: 'Update failed',
  };
}

/**
 * The Android in-app updater's install prompt (T-1725), drawn from
 * `docs/design/mockups/updater/`: the `ConfirmDialog` shell with a download
 * `IconTile`, the title and a mono 12 px detail line. Mounted once at the app
 * root; it shows nothing on iOS, on a quiet download or in any state with no
 * prompt. A failure is prompted here only for a download or an install; a failed
 * check the user started is reported by the Settings row instead.
 */
export function UpdateDialog() {
  const update = useAppUpdate();
  const [dismissedFailure, setDismissedFailure] = useState<string | null>(null);
  const [lastPrompt, setLastPrompt] = useState<PromptContext | null>(null);

  if (Platform.OS !== 'android') {
    return null;
  }
  const { state } = update;
  // Leaving `failed` clears the local dismissal, so a later failure that repeats
  // the same message (e.g. after Try again) shows the dialog again. A store emit
  // that keeps the failure, like the foreground return's `setLastCheckedAt`,
  // does not, so a dismissed failure no longer pops back up on its own.
  if (state.status !== 'failed' && dismissedFailure !== null) {
    setDismissedFailure(null);
  }

  const prompt = contentFor(update);
  if (prompt !== null) {
    const next = promptContext(prompt);
    if (!samePrompt(lastPrompt, next)) {
      setLastPrompt(next);
    }
  } else if ((state.status === 'idle' || state.status === 'upToDate') && lastPrompt !== null) {
    // Nothing is pending, so drop the remembered prompt: a later failure that
    // never showed one falls back to the generic header.
    setLastPrompt(null);
  }

  let content = prompt;
  if (state.status === 'failed') {
    const message = state.message;
    content =
      state.source === 'check' || message === dismissedFailure
        ? null
        : failedContent(lastPrompt, message, () => setDismissedFailure(message), update.checkNow);
  }
  if (content === null) {
    return null;
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={content.dismiss.onPress}
      accessibilityLabel={content.accessibilityLabel}
    >
      <View className="flex-1 items-center justify-center bg-black/40 p-6">
        <View className="w-full max-w-xs rounded-2xl border border-border-strong bg-surface p-4">
          <View className="flex-row items-center gap-3">
            <IconTile>
              <Download size={18} color={ICON} />
            </IconTile>
            <View className="min-w-0 flex-1">
              <Text className="text-[16px] font-semibold text-foreground">{content.title}</Text>
              {content.detail === null ? null : (
                <Text className="mt-0.5 font-mono text-[12px] text-subtle-foreground">
                  {content.detail}
                </Text>
              )}
            </View>
          </View>
          {content.message === undefined ? null : (
            <Text className="mt-4 text-[14px] leading-5 text-muted-foreground">
              {content.message}
            </Text>
          )}
          {content.progress === undefined ? null : (
            <View className="mt-4">
              <ProgressWell progress={content.progress} />
            </View>
          )}
          {content.error === undefined ? null : (
            <Text accessibilityRole="alert" className="mt-2 text-[13px] text-danger">
              {content.error}
            </Text>
          )}
          <View className="mt-4 flex-row justify-end gap-2">
            <Button variant="ghost" size="sm" onPress={content.dismiss.onPress}>
              <Text>{content.dismiss.label}</Text>
            </Button>
            {content.primary === undefined ? null : (
              <Button size="sm" onPress={content.primary.onPress}>
                <Text>{content.primary.label}</Text>
              </Button>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}
