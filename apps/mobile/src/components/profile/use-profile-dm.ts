import { Effect } from 'effect';
import { useRouter } from 'expo-router';

import { resolveDmChatId } from '@/components/chat/dm-chat-id';
import type { ProfilePerson } from '@/components/profile/profile-person';
import type { ToastMessage } from '@/components/ui/toast';
import { chatSubtitle } from '@/lib/chat';
import { mutedUntilFor } from '@/lib/chat-prefs';
import { useChatStore } from '@/store/chat-store-provider';

/**
 * Lifts a *-api.ts call into an Effect that fails with the thrown error
 * itself: the failure helpers read its class, status and code.
 */
function fromThrown<A>(call: () => Promise<A>): Effect.Effect<A, unknown> {
  return Effect.tryPromise({ try: call, catch: (cause) => cause });
}

type UseProfileDmOptions = {
  profile: ProfilePerson | null;
  /** The local domain from my JID, for the DM id fallback (`resolveDmChatId`). */
  domain: string | undefined;
  /** Runs the mute write with its own failure line (the screen's pref action). */
  runPref: (work: Effect.Effect<unknown, unknown>) => void;
  setActionError: (message: string) => void;
  setToast: (toast: ToastMessage) => void;
};

/**
 * The DM side of the profile screen (T-1308): resolves the peer's DM against
 * the contacts list, derives the status/online the header shows, and owns the
 * Message / Mute / Search / Copy actions. The screen keeps the profile lookup
 * and the contact-request actions; everything here is the existing chat-list
 * and chat-pref plumbing reused from the row swipe and the chat header.
 */
export function useProfileDm({
  profile,
  domain,
  runPref,
  setActionError,
  setToast,
}: UseProfileDmOptions) {
  const router = useRouter();
  const chats = useChatStore((state) => state.chats);
  const contacts = useChatStore((state) => state.contacts);
  const reloadChats = useChatStore((state) => state.reloadChats);
  const setChatPref = useChatStore((state) => state.setChatPref);

  const dmChatId =
    profile === null || domain === undefined
      ? undefined
      : resolveDmChatId(profile.userId, contacts, domain);
  const dmChat = dmChatId === undefined ? undefined : chats.find((chat) => chat.id === dmChatId);
  const muted = dmChat?.muted === true;

  // The DM already exists on the server for every contact; the chat list only
  // has to catch up. Web opens it the same way (`NewMessageDialog.tsx:50-53`):
  // push the chat id at once and reload the list, so the chat screen's
  // skeleton covers the wait. The contacts list carries the peer's real JID;
  // the lowercased id only matches when the server kept it
  // (`resolveDmChatId`), so a hashed id answers with a fixed error.
  const openMessage = (): void => {
    if (dmChatId === undefined) {
      setActionError('Could not open that chat. Try again.');
      return;
    }
    if (!chats.some((chat) => chat.id === dmChatId)) {
      reloadChats();
    }
    router.push({ pathname: '/chat/[id]', params: { id: dmChatId } });
  };

  // The existing mute action (the row swipe's): mute forever, or unmute.
  const toggleMute = (): void => {
    if (dmChatId === undefined) {
      return;
    }
    const input = muted
      ? { mutedUntil: null }
      : { mutedUntil: mutedUntilFor('forever', new Date()) };
    runPref(fromThrown(() => setChatPref(dmChatId, input)));
  };

  // The chat header's "Search in chat": the chats screen opens it from the
  // `searchChat` parameter, so the profile routes there the same way.
  const openSearch = (): void => {
    if (dmChatId === undefined) {
      return;
    }
    router.push({ pathname: '/', params: { searchChat: dmChatId } });
  };

  // Copies "@handle"; the toast confirms it. The clipboard module loads on
  // first use, as before.
  const copyUsername = (): void => {
    if (profile === null) {
      return;
    }
    const text = `@${profile.handle}`;
    Effect.runFork(
      Effect.tryPromise({ try: () => import('expo-clipboard'), catch: (cause) => cause }).pipe(
        Effect.flatMap((Clipboard) =>
          Effect.tryPromise({
            try: () => Clipboard.setStringAsync(text),
            catch: (cause) => cause,
          }),
        ),
        Effect.tap(() =>
          Effect.sync(() => setToast({ id: Date.now(), text: 'Username copied', tone: 'notice' })),
        ),
        Effect.ignore,
      ),
    );
  };

  const status =
    dmChat !== undefined
      ? chatSubtitle(dmChat, new Date())
      : profile === null
        ? ''
        : `@${profile.handle}`;
  const online = dmChat?.online === true;

  return { dmChatId, muted, status, online, openMessage, toggleMute, openSearch, copyUsername };
}
