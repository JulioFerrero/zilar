import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import type { GroupInviteLink } from '@/lib/invite-links-api';

export type InviteLinkState = 'active' | 'expired' | 'exhausted' | 'revoked';

export function inviteLinkState(link: GroupInviteLink, now: number): InviteLinkState {
  if (link.revoked) {
    return 'revoked';
  }
  if (link.expiresAt !== null && Date.parse(link.expiresAt) <= now) {
    return 'expired';
  }
  if (link.maxUses !== null && link.uses >= link.maxUses) {
    return 'exhausted';
  }
  return 'active';
}

/** "Friends — 2/10 uses, expires …" for one link row (mirrors the web list). */
export function describeInviteLink(link: GroupInviteLink, now: number): string {
  const state = inviteLinkState(link, now);
  const used = link.maxUses === null ? `${link.uses} uses` : `${link.uses}/${link.maxUses} uses`;
  const expiry =
    link.expiresAt === null
      ? 'never expires'
      : `expires ${new Date(link.expiresAt).toLocaleString()}`;
  const name = link.label === null || link.label === '' ? `····${link.tokenHint}` : link.label;
  return state === 'active'
    ? `${name} — ${used}, ${expiry}`
    : `${name} — ${used}, ${expiry}, ${state}`;
}

/**
 * The clipboard/share bridge the screen injects: `expo-clipboard` and React
 * Native's `Share` cannot run in Node tests, so the pure views below take
 * callbacks and the sheet wires the real modules at the edge.
 */
export interface InviteLinkShareBridge {
  copyText: (text: string) => Promise<void>;
  shareText: (text: string) => Promise<void>;
}

export type CreateInviteLinkForm = {
  label?: string;
  expiresInHours?: number;
  maxUses?: number;
};

/**
 * Validates the create form (web `InviteLinksSection` rules): label ≤ 60,
 * expiry 1..8760 hours, max uses 1..10000. Returns the error text or the
 * parsed input.
 */
export function validateInviteLinkForm(input: {
  label: string;
  expiry: string;
  maxUses: string;
}): { error: string } | { input: CreateInviteLinkForm } {
  const trimmed = input.label.trim();
  if (trimmed.length > 60) {
    return { error: 'The label must be at most 60 characters.' };
  }
  const expiresInHours = input.expiry.trim() === '' ? undefined : Number(input.expiry.trim());
  if (
    expiresInHours !== undefined &&
    (!Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > 8760)
  ) {
    return { error: 'Expiry must be 1 to 8760 hours.' };
  }
  const maxUses = input.maxUses.trim() === '' ? undefined : Number(input.maxUses.trim());
  if (maxUses !== undefined && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 10000)) {
    return { error: 'Max uses must be 1 to 10000.' };
  }
  return {
    input: {
      ...(trimmed === '' ? {} : { label: trimmed }),
      ...(expiresInHours === undefined ? {} : { expiresInHours }),
      ...(maxUses === undefined ? {} : { maxUses }),
    },
  };
}

/**
 * The invite-links sheet (T-0136): owners and admins create a link (label,
 * expiry, max uses), see the URL once with Copy and the system Share sheet
 * plus a warning that anyone with the link can join, and list/revoke links.
 * Thin view: the screen loads the list and performs the actions. The token
 * is shown only in `createdUrl` and never stored — dismissing it drops it.
 */
export function InviteLinksSheet({
  visible,
  links,
  busy,
  error,
  createdUrl,
  revokingId,
  now,
  share,
  onCreate,
  onRevoke,
  onDismissCreated,
  onClose,
}: {
  visible: boolean;
  links: GroupInviteLink[];
  busy: boolean;
  error: string;
  createdUrl: string | undefined;
  revokingId: string | undefined;
  /** Fixed by the screen each time the sheet opens: the expired/exhausted
   *  labels render against it. A mount-time stamp would go stale (the Modal
   *  stays mounted while hidden). */
  now: number;
  share: InviteLinkShareBridge;
  onCreate: (input: CreateInviteLinkForm) => void;
  onRevoke: (linkId: string) => void;
  onDismissCreated: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [label, setLabel] = useState('');
  const [expiry, setExpiry] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [copied, setCopied] = useState(false);
  const [formError, setFormError] = useState('');

  const submit = (): void => {
    const result = validateInviteLinkForm({ label, expiry, maxUses });
    if ('error' in result) {
      setFormError(result.error);
      return;
    }
    setFormError('');
    onCreate(result.input);
  };

  const copy = (): void => {
    if (createdUrl === undefined) {
      return;
    }
    void share.copyText(createdUrl).then(() => setCopied(true));
  };

  const shareLink = (): void => {
    if (createdUrl === undefined) {
      return;
    }
    void share.shareText(createdUrl).catch(() => {});
  };

  const shownError = formError !== '' ? formError : error;
  // The expired/exhausted labels render against `now`, which the screen
  // fixes on every open (see `openLinks`), so they never go stale.

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Close invite links"
        onPress={onClose}
        className="flex-1 justify-end bg-black/40"
      >
        <Pressable
          onPress={() => {}}
          className="max-h-[85%] rounded-t-2xl border-t border-border-strong bg-surface px-4 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, 16) }}
        >
          <View className="mb-1 h-1 w-10 self-center rounded-full bg-surface-raised" />
          <Text accessibilityRole="header" className="text-[18px] font-semibold text-foreground">
            Invite links
          </Text>

          {createdUrl !== undefined ? (
            <CreatedInviteLinkView
              url={createdUrl}
              copied={copied}
              onCopy={copy}
              onShare={shareLink}
              onDone={() => {
                setCopied(false);
                onDismissCreated();
              }}
            />
          ) : null}

          <Text className="mt-4 text-[14px] font-medium text-foreground">Label (optional)</Text>
          <TextField
            value={label}
            onChangeText={setLabel}
            maxLength={60}
            editable={!busy}
            placeholder="e.g. Friends"
            accessibilityLabel="Link label"
            className="mt-1"
          />
          <View className="mt-2 flex-row gap-2">
            <View className="flex-1">
              <Text className="text-[14px] font-medium text-foreground">Expires in (hours)</Text>
              <TextField
                value={expiry}
                onChangeText={setExpiry}
                keyboardType="numeric"
                editable={!busy}
                placeholder="e.g. 48"
                accessibilityLabel="Expiry in hours"
                className="mt-1"
              />
            </View>
            <View className="flex-1">
              <Text className="text-[14px] font-medium text-foreground">Max uses</Text>
              <TextField
                value={maxUses}
                onChangeText={setMaxUses}
                keyboardType="numeric"
                editable={!busy}
                placeholder="e.g. 10"
                accessibilityLabel="Max uses"
                className="mt-1"
              />
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create invite link"
            disabled={busy}
            onPress={submit}
            className="mt-3 items-center rounded-full bg-accent px-4 py-2.5 active:opacity-90 disabled:opacity-50"
          >
            <Text className="text-[15px] font-medium text-accent-foreground">
              {busy ? 'Creating…' : 'Create invite link'}
            </Text>
          </Pressable>
          {shownError !== '' ? (
            <Text accessibilityRole="alert" className="mt-2 text-[14px] text-danger">
              {shownError}
            </Text>
          ) : null}

          <View className="mt-3 gap-1 pb-2">
            {links.length === 0 ? (
              <Text className="text-[14px] text-muted-foreground">No invite links yet.</Text>
            ) : (
              links.map((link) => (
                <InviteLinkRow
                  key={link.id}
                  link={link}
                  now={now}
                  revoking={revokingId === link.id}
                  onRevoke={onRevoke}
                />
              ))
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function InviteLinkRowView({
  link,
  now,
  revoking,
  onRevoke,
}: {
  link: GroupInviteLink;
  now: number;
  revoking: boolean;
  onRevoke: (linkId: string) => void;
}) {
  const state = inviteLinkState(link, now);
  const name = link.label === null || link.label === '' ? `····${link.tokenHint}` : link.label;
  return (
    <View className="flex-row items-center gap-2 rounded-xl px-1 py-1.5">
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="font-mono text-[14px] text-foreground">
          {name}
        </Text>
        <Text numberOfLines={1} className="text-[12px] text-muted-foreground">
          {describeInviteLink(link, now)}
        </Text>
      </View>
      {state !== 'revoked' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Revoke invite link ${link.label ?? link.tokenHint}`}
          disabled={revoking}
          onPress={() => onRevoke(link.id)}
          className="shrink-0 rounded-full border border-border-strong px-3 py-1 active:bg-surface-raised disabled:opacity-50"
        >
          <Text className="text-[13px] font-medium text-foreground">
            {revoking ? 'Revoking…' : 'Revoke'}
          </Text>
        </Pressable>
      ) : (
        <Text className="shrink-0 px-2 text-[12px] text-muted-foreground">revoked</Text>
      )}
    </View>
  );
}

/**
 * One invite-link row (pure, no hooks): the name (label or last-4 hint) with
 * its uses/expiry line and a Revoke button, or a "revoked" label. The full
 * token never appears here — only the hint. `now` is injected (the screen
 * fixes it once per list load) so the render stays pure.
 */
export function InviteLinkRow({
  link,
  now,
  revoking,
  onRevoke,
}: {
  link: GroupInviteLink;
  now: number;
  revoking: boolean;
  onRevoke: (linkId: string) => void;
}) {
  return <InviteLinkRowView link={link} now={now} revoking={revoking} onRevoke={onRevoke} />;
}

/**
 * The shown-once block (pure, no hooks): the full URL with Copy and the
 * system Share sheet plus the anyone-with-the-link warning. The caller drops
 * `url` on Done, so the token is never stored.
 */
export function CreatedInviteLinkView({
  url,
  copied,
  onCopy,
  onShare,
  onDone,
}: {
  url: string;
  copied: boolean;
  onCopy: () => void;
  onShare: () => void;
  onDone: () => void;
}) {
  return (
    <View className="mt-3 gap-2 rounded-xl border border-border-strong bg-surface-raised p-3">
      <Text className="text-[14px] font-medium text-foreground">Share this link</Text>
      <View className="rounded-lg border border-divider bg-well px-2 py-2">
        <Text numberOfLines={1} className="font-mono text-[13px] text-foreground">
          {url}
        </Text>
      </View>
      <View className="flex-row gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy invite link"
          onPress={onCopy}
          className="flex-1 items-center rounded-full bg-accent px-4 py-2 active:opacity-90"
        >
          <Text className="text-[15px] font-medium text-accent-foreground">
            {copied ? 'Copied' : 'Copy'}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Share invite link"
          onPress={onShare}
          className="flex-1 items-center rounded-full border border-border-strong px-4 py-2 active:bg-surface-raised"
        >
          <Text className="text-[15px] font-medium text-foreground">Share</Text>
        </Pressable>
      </View>
      <Text className="text-[13px] text-muted-foreground">
        Anyone with this link can join the group. It is shown once — copy it now.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Done with invite link"
        onPress={onDone}
      >
        <Text className="text-[14px] font-medium text-accent">Done</Text>
      </Pressable>
    </View>
  );
}
