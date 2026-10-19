import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Text, TextField } from '../../components/ui/text';
import { extractJoinToken, joinFailureMessage } from '../../lib/invite-links-api';
import type { JoinPreview } from '../../lib/invite-links-api';

/** One neutral invalid state for every failure kind; an unreachable server
 *  gets a retry. The token never appears in any message. */
export type JoinLinkState = 'checking' | 'ready' | 'invalid' | 'offline';

export interface JoinLinkView {
  state: JoinLinkState;
  preview?: JoinPreview;
  error?: string;
}

export function joinLinkViewFor(input: {
  preview?: JoinPreview;
  failed: boolean;
  rateLimited: boolean;
  offline?: boolean;
  joinRetry?: boolean;
}): JoinLinkView {
  if (!input.failed && input.preview !== undefined) {
    return {
      state: 'ready',
      preview: input.preview,
      ...(input.joinRetry === true ? { error: 'Could not join the group. Try again.' } : {}),
    };
  }
  if (input.offline === true) {
    return { state: 'offline' };
  }
  return {
    state: 'invalid',
    error: input.rateLimited
      ? joinFailureMessage({ status: 429, code: 'rate_limited' })
      : joinFailureMessage({ status: 404, code: 'invalid_link' }),
  };
}

function joinErrorStatus(error: unknown): { status: number | undefined; code: string | undefined } {
  if (typeof error !== 'object' || error === null) {
    return { status: undefined, code: undefined };
  }
  const status = 'status' in error && typeof error.status === 'number' ? error.status : undefined;
  const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
  return { status, code };
}

/** Raw server text never reaches the UI: only the status/code, never the token. */
export function joinPreviewFailure(error: unknown): { rateLimited: boolean; offline: boolean } {
  const { status, code } = joinErrorStatus(error);
  if (status === 429 || code === 'rate_limited') {
    return { rateLimited: true, offline: false };
  }
  if (status === 0 || code === 'network_error') {
    return { rateLimited: false, offline: true };
  }
  return { rateLimited: false, offline: false };
}

/** The raw error never reaches the rendered text, so a leaked token cannot leak into the UI. */
export function joinPressFailure(error: unknown, preview: JoinPreview): JoinLinkView {
  const { status, code } = joinErrorStatus(error);
  if (status === 429 || code === 'rate_limited') {
    return joinLinkViewFor({ failed: true, rateLimited: true });
  }
  if (status === 0 || code === 'network_error') {
    return joinLinkViewFor({
      preview,
      failed: false,
      rateLimited: false,
      joinRetry: true,
    });
  }
  return joinLinkViewFor({ failed: true, rateLimited: false });
}

/** The preview subtitle: "6 members", never member names. */
export function joinPreviewSubtitle(preview: JoinPreview): string {
  if (preview.kind === 'channel') {
    return `${preview.memberCount} ${preview.memberCount === 1 ? 'subscriber' : 'subscribers'}`;
  }
  return `${preview.memberCount} ${preview.memberCount === 1 ? 'member' : 'members'}`;
}

export function joinButtonTitle(preview: JoinPreview): string {
  if (preview.alreadyMember) {
    return preview.kind === 'channel' ? 'Open the channel' : 'Open the group';
  }
  return preview.kind === 'channel' ? 'Join the channel' : 'Join the group';
}

export function JoinLinkBody(props: {
  view: JoinLinkView;
  busy: boolean;
  onJoin: () => void;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const { view, busy, onJoin, onCancel, onRetry } = props;
  if (view.state === 'checking') {
    return (
      <View className="w-full max-w-sm rounded-2xl bg-background p-6 shadow-xl">
        <Text className="text-center text-[18px] font-semibold text-foreground">
          Checking your invite link…
        </Text>
      </View>
    );
  }
  if (view.state === 'offline') {
    return (
      <View className="w-full max-w-sm rounded-2xl bg-background p-6 shadow-xl">
        <Text className="text-center text-[24px] font-semibold leading-8 text-foreground">
          Could not load the link
        </Text>
        <Text className="mt-2 text-center text-[15px] text-muted-foreground">
          Check your connection and try again.
        </Text>
        <Button
          variant="default"
          className="mt-5"
          accessibilityLabel="Retry loading the link"
          onPress={onRetry}
        >
          <Text>Try again</Text>
        </Button>
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onCancel}>
          <Text className="mt-3 text-center text-[14px] text-muted-foreground">Cancel</Text>
        </Pressable>
      </View>
    );
  }
  if (view.state === 'invalid' || view.preview === undefined) {
    return (
      <View className="w-full max-w-sm rounded-2xl bg-background p-6 shadow-xl">
        <Text className="text-center text-[24px] font-semibold leading-8 text-foreground">
          This link does not work
        </Text>
        <Text className="mt-2 text-center text-[15px] text-muted-foreground">
          {view.error === undefined ? 'This link does not work' : view.error}
        </Text>
        <Button variant="default" className="mt-5" accessibilityLabel="Cancel" onPress={onCancel}>
          <Text>Back to chats</Text>
        </Button>
      </View>
    );
  }
  const preview = view.preview;
  return (
    <View className="w-full max-w-sm rounded-2xl bg-background p-6 shadow-xl">
      <Text className="text-center text-[24px] font-semibold leading-8 text-foreground">
        {preview.groupTitle}
      </Text>
      <Text className="mt-2 text-center text-[15px] text-muted-foreground">
        {joinPreviewSubtitle(preview)}
      </Text>
      {preview.alreadyMember ? (
        <Text className="mt-2 text-center text-[14px] text-muted-foreground">
          You are already a member of this group.
        </Text>
      ) : null}
      {view.error !== undefined ? (
        <Text accessibilityRole="alert" className="mt-3 text-center text-[14px] text-danger">
          {view.error}
        </Text>
      ) : null}
      <Button
        variant="default"
        className="mt-5"
        accessibilityLabel={preview.alreadyMember ? 'Open the group' : joinButtonTitle(preview)}
        disabled={busy}
        onPress={onJoin}
      >
        <Text>{busy ? 'Joining…' : joinButtonTitle(preview)}</Text>
      </Button>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onCancel}>
        <Text className="mt-3 text-center text-[14px] text-muted-foreground">Cancel</Text>
      </Pressable>
    </View>
  );
}

export function JoinLinkForm({
  visible,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  onSubmit: (token: string) => void;
  onClose: () => void;
}) {
  const [raw, setRaw] = useState('');
  const [error, setError] = useState('');

  if (!visible && (raw !== '' || error !== '')) {
    setRaw('');
    setError('');
  }

  const submit = (): void => {
    const token = extractJoinToken(raw);
    if (token === undefined) {
      setError('That does not look like an invite link.');
      return;
    }
    setError('');
    onSubmit(token);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      closeLabel="Close join with a link"
      title="Join with a link"
      footer={
        <Button accessibilityLabel="Continue with link" onPress={submit}>
          <Text>Continue</Text>
        </Button>
      }
    >
      <Text className="mt-1 text-[14px] text-muted-foreground">
        Paste the invite link a group admin shared with you.
      </Text>
      <TextField
        value={raw}
        onChangeText={setRaw}
        autoCapitalize="none"
        autoCorrect={false}
        editable={true}
        placeholder="zilar://join/…"
        accessibilityLabel="Invite link"
        className="mt-3"
      />
      {error !== '' ? (
        <Text accessibilityRole="alert" className="mt-2 text-[14px] text-danger">
          {error}
        </Text>
      ) : null}
    </BottomSheet>
  );
}
