import * as Clipboard from 'expo-clipboard';
import { Effect } from 'effect';
import { useMemo, useState } from 'react';
import { Share } from 'react-native';

import { groupAction, rawCall } from '@/components/chat/group-action';
import type { CreateInviteLinkForm } from '@/components/chat/invite-links-sheet';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import type { GroupInviteLink } from '@/lib/invite-links-api';
import { useChatStore } from '@/store/chat-store-provider';

/**
 * The group screen's invite-links sheet state and writes (T-0136): owner/admin
 * only, like the web panel. The list loads when the sheet opens; the created
 * URL is kept only until dismissed, never stored. A failed load keeps the sheet
 * open with a message. It also owns the clipboard/share bridge the shown-once
 * block and the visibility sheet both use.
 */
export function useGroupInviteLinks(groupId: string) {
  const listInviteLinks = useChatStore((state) => state.listInviteLinks);
  const createInviteLink = useChatStore((state) => state.createInviteLink);
  const revokeInviteLink = useChatStore((state) => state.revokeInviteLink);

  const [linksOpen, setLinksOpen] = useState(false);
  const [linksNow, setLinksNow] = useState(() => Date.now());
  const [links, setLinks] = useState<GroupInviteLink[]>([]);
  const [linksError, setLinksError] = useState('');
  const [createdUrl, setCreatedUrl] = useState<string | undefined>(undefined);
  const [revokingId, setRevokingId] = useState<string | undefined>(undefined);

  const fetchLinks = (linksGroupId: string) =>
    Effect.sync(() => {
      setLinksError('');
    }).pipe(
      Effect.andThen(
        groupAction(
          rawCall(() => listInviteLinks(linksGroupId)).pipe(
            Effect.tap((list) =>
              Effect.sync(() => {
                setLinks(list);
              }),
            ),
          ),
          () => setLinksError('Could not load invite links. Try again.'),
        ),
      ),
    );
  const [, loadLinks] = useAction((linksGroupId: string) => fetchLinks(linksGroupId));

  const open = () => {
    setLinksError('');
    setCreatedUrl(undefined);
    setRevokingId(undefined);
    // Fresh clock for the expired/exhausted labels on every open: the sheet
    // stays mounted while hidden, so a mount-time stamp would go stale.
    setLinksNow(Date.now());
    setLinksOpen(true);
    loadLinks(groupId);
  };

  const [linkCreate, runLinkCreate] = useAction((input: CreateInviteLinkForm) =>
    groupAction(
      rawCall(() => createInviteLink(groupId, input)).pipe(
        Effect.tap((created) =>
          Effect.sync(() => {
            setCreatedUrl(created.url);
          }),
        ),
        Effect.andThen(fetchLinks(groupId)),
      ),
      () => setLinksError('Could not create the invite link. Try again.'),
    ),
  );
  const linksBusy = isWaiting(linkCreate);

  const [, runLinkRevoke] = useAction((linkId: string) =>
    groupAction(
      rawCall(() => revokeInviteLink(groupId, linkId)).pipe(Effect.andThen(fetchLinks(groupId))),
      () => setLinksError('Could not revoke the invite link. Try again.'),
      () => setRevokingId(undefined),
    ),
  );

  const create = (input: CreateInviteLinkForm) => {
    setLinksError('');
    runLinkCreate(input);
  };

  const revoke = (linkId: string) => {
    setRevokingId(linkId);
    setLinksError('');
    runLinkRevoke(linkId);
  };

  // The clipboard/share bridge for the shown-once block: `expo-clipboard`
  // and React Native's `Share` cannot run in Node tests, so the sheet takes
  // callbacks and this screen wires the real modules at the edge. The
  // sheets await these, so each returns a Promise.
  const share = useMemo(
    () => ({
      copyText: (text: string) =>
        Effect.runPromise(Effect.promise(() => Clipboard.setStringAsync(text)).pipe(Effect.asVoid)),
      shareText: (text: string) =>
        Effect.runPromise(
          Effect.tryPromise({
            try: () => Share.share({ message: text }),
            catch: (cause) => cause,
          }).pipe(Effect.asVoid),
        ),
    }),
    [],
  );

  return {
    visible: linksOpen,
    open,
    close: () => {
      if (!linksBusy) {
        setLinksOpen(false);
      }
    },
    links,
    busy: linksBusy,
    error: linksError,
    createdUrl,
    revokingId,
    now: linksNow,
    share,
    create,
    revoke,
    dismissCreated: () => setCreatedUrl(undefined),
  };
}
