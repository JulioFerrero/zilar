import * as Clipboard from 'expo-clipboard';
import { Data, Effect } from 'effect';
import { useMemo, useState } from 'react';
import { Share } from 'react-native';

import type { CreateInviteLinkForm } from '@/components/chat/invite-links-sheet';
import { useChatStore } from '@/store/chat-store-provider';

/** A store call that rejected; `code` is what the server said (empty when none). */
export class ChannelCallFailed extends Data.TaggedError('ChannelCallFailed')<{
  readonly code: string;
}> {}

const codeOf = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : '';

export function callStore<A>(call: () => Promise<A>): Effect.Effect<A, ChannelCallFailed> {
  return Effect.tryPromise({
    try: call,
    catch: (error) => new ChannelCallFailed({ code: codeOf(error) }),
  });
}

// The channel screen's invite-links sheet state and writes, owner/admin only like web. The list loads when the sheet opens; the created URL is kept only until dismissed, never stored.
export function useChannelInvites(groupId: string) {
  const listInviteLinks = useChatStore((state) => state.listInviteLinks);
  const createInviteLink = useChatStore((state) => state.createInviteLink);
  const revokeInviteLink = useChatStore((state) => state.revokeInviteLink);

  const [linksOpen, setLinksOpen] = useState(false);
  const [linksNow, setLinksNow] = useState(() => Date.now());
  const [links, setLinks] = useState<
    {
      id: string;
      label: string | null;
      tokenHint: string;
      uses: number;
      maxUses: number | null;
      expiresAt: string | null;
      revoked: boolean;
      createdAt: string;
    }[]
  >([]);
  const [linksBusy, setLinksBusy] = useState(false);
  const [linksError, setLinksError] = useState('');
  const [createdUrl, setCreatedUrl] = useState<string | undefined>(undefined);
  const [revokingId, setRevokingId] = useState<string | undefined>(undefined);

  // The links list, each step an Effect run in the background; a new load clears the error first and a failed load keeps the last list.
  const reloadLinks = (): Effect.Effect<void> =>
    Effect.sync(() => setLinksError('')).pipe(
      Effect.andThen(callStore(() => listInviteLinks(groupId))),
      Effect.match({
        onFailure: () => setLinksError('Could not load invite links. Try again.'),
        onSuccess: (next) => setLinks(next),
      }),
    );

  const openLinks = () => {
    setLinksError('');
    setCreatedUrl(undefined);
    setRevokingId(undefined);
    setLinksNow(Date.now());
    setLinksOpen(true);
    Effect.runFork(reloadLinks());
  };

  // The clipboard/share bridge: `expo-clipboard` and `Share` cannot run in Node tests, so the sheet takes callbacks and the screen wires the real modules at the edge.
  const linksShare = useMemo(
    () => ({
      copyText: (text: string) =>
        Effect.runPromise(
          Effect.tryPromise({
            try: () => Clipboard.setStringAsync(text),
            catch: (error) => error,
          }).pipe(Effect.asVoid),
        ),
      shareText: (text: string): Promise<void> =>
        Effect.runPromise(
          Effect.tryPromise({
            try: () => Share.share({ message: text }),
            catch: (error) => error,
          }).pipe(Effect.asVoid),
        ),
    }),
    [],
  );

  return {
    open: openLinks,
    visible: linksOpen,
    links,
    busy: linksBusy,
    error: linksError,
    createdUrl,
    revokingId,
    now: linksNow,
    share: linksShare,
    onCreate: (input: CreateInviteLinkForm) => {
      setLinksBusy(true);
      setLinksError('');
      Effect.runFork(
        callStore(() => createInviteLink(groupId, input)).pipe(
          Effect.tap((created) => Effect.sync(() => setCreatedUrl(created.url))),
          Effect.andThen(reloadLinks()),
          Effect.catchTag('ChannelCallFailed', () =>
            Effect.sync(() => setLinksError('Could not create the invite link. Try again.')),
          ),
          Effect.ensuring(Effect.sync(() => setLinksBusy(false))),
        ),
      );
    },
    onRevoke: (linkId: string) => {
      setRevokingId(linkId);
      setLinksError('');
      Effect.runFork(
        callStore(() => revokeInviteLink(groupId, linkId)).pipe(
          Effect.andThen(reloadLinks()),
          Effect.catchTag('ChannelCallFailed', () =>
            Effect.sync(() => setLinksError('Could not revoke the invite link. Try again.')),
          ),
          Effect.ensuring(Effect.sync(() => setRevokingId(undefined))),
        ),
      );
    },
    onDismissCreated: () => setCreatedUrl(undefined),
    onClose: () => {
      if (!linksBusy) {
        setLinksOpen(false);
      }
    },
  };
}
