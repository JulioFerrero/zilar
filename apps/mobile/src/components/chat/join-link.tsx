import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '../../components/ui/text';
import { extractJoinToken, joinFailureMessage } from '../../lib/invite-links-api';
import type { JoinPreview } from '../../lib/invite-links-api';

/**
 * The join-by-link states (T-0136, mirrors the web `JoinPage`): checking the
 * preview, ready to join, and one neutral invalid state for every failure
 * kind (invalid, expired, revoked, full). Rate limits get a friendly retry
 * text instead. The token never appears in any message — only the neutral
 * texts below are shown.
 */
export type JoinLinkState = 'checking' | 'ready' | 'invalid';

export interface JoinLinkView {
  state: JoinLinkState;
  preview?: JoinPreview;
  error?: string;
}

/**
 * Reduces a preview/join outcome to its view state. `retryable` is true for
 * rate-limit answers (429), which show the retry text; every other failure
 * shows the same neutral message. Takes only the error code/status, never
 * the token.
 */
export function joinLinkViewFor(input: {
  preview?: JoinPreview;
  failed: boolean;
  rateLimited: boolean;
  joinError?: string;
}): JoinLinkView {
  if (!input.failed && input.preview !== undefined) {
    return {
      state: 'ready',
      preview: input.preview,
      ...(input.joinError === undefined ? {} : { error: input.joinError }),
    };
  }
  return {
    state: 'invalid',
    error: input.rateLimited
      ? joinFailureMessage({ status: 429, code: 'rate_limited' })
      : joinFailureMessage({ status: 404, code: 'invalid_link' }),
  };
}

/** The preview subtitle: "6 members" (never member names). */
export function joinPreviewSubtitle(preview: JoinPreview): string {
  return `${preview.memberCount} ${preview.memberCount === 1 ? 'member' : 'members'}`;
}

/**
 * The join screen body (T-0136): the preview card (group title, member
 * count) with Join and Cancel, the neutral failure card, and the checking
 * state. Signed-out and nameless handling lives in the route (`join.tsx`),
 * which redirects through the existing sign-in and back. Thin view: the
 * route loads the preview and performs the join.
 */
export function JoinLinkBody(props: {
  view: JoinLinkView;
  busy: boolean;
  onJoin: () => void;
  onCancel: () => void;
}) {
  const { view, busy, onJoin, onCancel } = props;
  if (view.state === 'checking') {
    return (
      <View className="w-full max-w-sm rounded-2xl bg-background p-6 shadow-xl">
        <Text className="text-center text-[18px] font-semibold text-foreground">
          Checking your invite link…
        </Text>
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          onPress={onCancel}
          className="mt-5 items-center rounded-full bg-accent px-4 py-2.5 active:opacity-90"
        >
          <Text className="text-[15px] font-medium text-accent-foreground">Back to chats</Text>
        </Pressable>
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={preview.alreadyMember ? 'Open the group' : 'Join the group'}
        disabled={busy}
        onPress={onJoin}
        className="mt-5 items-center rounded-full bg-accent px-4 py-2.5 active:opacity-90 disabled:opacity-60"
      >
        <Text className="text-[15px] font-medium text-accent-foreground">
          {busy ? 'Joining…' : preview.alreadyMember ? 'Open the group' : 'Join the group'}
        </Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onCancel}>
        <Text className="mt-3 text-center text-[14px] text-muted-foreground">Cancel</Text>
      </Pressable>
    </View>
  );
}

/**
 * The paste-a-link form for the new-chat menu: one field, one button. The
 * raw text is parsed locally (`extractJoinToken`); junk never reaches the
 * server, and the token never appears in any message.
 */
export function JoinLinkForm({ onSubmit }: { onSubmit: (token: string) => void }) {
  const [raw, setRaw] = useState('');
  const [error, setError] = useState('');

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
    <View className="w-full max-w-xs rounded-2xl border border-border-strong bg-surface p-4">
      <Text className="text-[16px] font-semibold text-foreground">Join with a link</Text>
      <Text className="mt-1 text-[14px] text-muted-foreground">
        Paste the invite link a group admin shared with you.
      </Text>
      <View className="mt-3 rounded-[10px] border border-border-strong bg-well px-3 py-2">
        <TextInput
          value={raw}
          onChangeText={setRaw}
          autoCapitalize="none"
          autoCorrect={false}
          editable={true}
          placeholder="galena://join/…"
          placeholderTextColor="#8a8a8a"
          accessibilityLabel="Invite link"
          className="text-[15px] text-foreground"
        />
      </View>
      {error !== '' ? (
        <Text accessibilityRole="alert" className="mt-2 text-[14px] text-danger">
          {error}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Continue with link"
        onPress={submit}
        className="mt-3 items-center rounded-full bg-accent px-4 py-2.5 active:opacity-90"
      >
        <Text className="text-[15px] font-medium text-accent-foreground">Continue</Text>
      </Pressable>
    </View>
  );
}

/** The gradient card wrapper the join route shares with the invite screen. */
export function JoinLinkCard(props: { children: unknown }) {
  return (
    <SafeAreaView className="flex-1 items-center justify-center p-4">
      <View className="w-full max-w-sm items-center">{props.children as never}</View>
    </SafeAreaView>
  );
}
