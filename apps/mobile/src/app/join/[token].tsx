import { Redirect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useColorScheme } from 'nativewind';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { LoadingScreen } from '@/auth/RequireAuth';
import { useSession } from '@/auth/session';
import { JoinLinkBody, joinLinkViewFor, type JoinLinkView } from '@/components/chat/join-link';
import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { CHAT_BACKGROUND } from '@/lib/colors';
import { extractJoinToken } from '@/lib/invite-links-api';
import { useChatStore } from '@/store/chat-store-provider';

/**
 * Join-by-link screen (T-0136): `galena://join/<token>` (custom scheme,
 * registered in `app.json`) and the web URL shape `/join/<token>` open this
 * route with the token as the `token` param. Shows the preview (group name,
 * member count) with Join and Cancel; Join calls `POST /api/join/:token`
 * and opens the group.
 *
 * Signed-out users go through the existing sign-in and return here (the
 * login `from` carries the join path); signed-in users without a display
 * name see the name gate inline (like the web `JoinPage`) and join only
 * after choosing a name. Failure kinds (invalid, expired, revoked, full)
 * all show the same neutral message; rate limits show a retry text. The
 * token never appears in any message — only status codes travel from the
 * store errors to the view.
 */
export default function JoinRoute() {
  const { status, me } = useSession();
  const params = useLocalSearchParams<{ token?: string }>();
  const raw = typeof params.token === 'string' ? params.token : undefined;
  const token = raw === undefined ? undefined : extractJoinToken(raw);

  if (status === 'loading') {
    return <LoadingScreen />;
  }
  if (status === 'guest') {
    const from = token === undefined ? '/join' : `/join/${token}`;
    return <Redirect href={`/login?from=${encodeURIComponent(from)}`} />;
  }
  if ((me?.name ?? '').trim() === '') {
    return <NameGate token={token} />;
  }
  return <Join token={token} />;
}

/** The inline name gate: choose a name first, then return to the join. */
function NameGate({ token }: { token: string | undefined }) {
  const router = useRouter();
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const from = token === undefined ? '/join' : `/join/${token}`;
  return (
    <JoinBackground scheme={scheme}>
      <View className="w-full max-w-sm rounded-2xl bg-background p-6 shadow-xl">
        <Text className="text-center text-[24px] font-semibold leading-8 text-foreground">
          You are invited
        </Text>
        <Text className="mt-2 text-center text-[15px] text-muted-foreground">
          Choose a display name first — your new group will see it.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose a name"
          onPress={() => router.replace(`/welcome/name?from=${encodeURIComponent(from)}` as Href)}
          className="mt-5 items-center rounded-full bg-accent px-4 py-2.5 active:opacity-90"
        >
          <Text className="text-[15px] font-medium text-accent-foreground">Choose a name</Text>
        </Pressable>
      </View>
    </JoinBackground>
  );
}

function Join({ token }: { token: string | undefined }) {
  const router = useRouter();
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const previewJoinLink = useChatStore((state) => state.previewJoinLink);
  const joinByLink = useChatStore((state) => state.joinByLink);
  const chats = useChatStore((state) => state.chats);
  // A missing token is invalid from the first render — no effect needed.
  const [view, setView] = useState<JoinLinkView>(
    token === undefined
      ? joinLinkViewFor({ failed: true, rateLimited: false })
      : { state: 'checking' },
  );
  const [busy, setBusy] = useState(false);
  const loadedFor = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (token === undefined) {
      return;
    }
    if (loadedFor.current === token) {
      return;
    }
    loadedFor.current = token;
    setView({ state: 'checking' });
    // The effect only synchronizes with the token (the lint rule flags
    // synchronous setState inside effects); the fetch helper resolves the
    // next view, applied once.
    let active = true;
    void loadPreview(token).then((next) => {
      if (active) {
        setView(next);
      }
    });
    return () => {
      active = false;
    };
    async function loadPreview(value: string): Promise<JoinLinkView> {
      try {
        const preview = await previewJoinLink(value);
        return joinLinkViewFor({ preview, failed: false, rateLimited: false });
      } catch (error: unknown) {
        const status = (error as { status?: number }).status;
        const code = (error as { code?: string }).code;
        return joinLinkViewFor({
          failed: true,
          rateLimited: status === 429 || code === 'rate_limited',
        });
      }
    }
  }, [token, previewJoinLink]);

  const cancel = () => {
    router.replace('/');
  };

  const join = () => {
    if (busy || token === undefined || view.state !== 'ready' || view.preview === undefined) {
      return;
    }
    const preview = view.preview;
    // Already a member: just open the group, no use consumed (server-side).
    if (preview.alreadyMember) {
      openGroup(preview.groupId);
      return;
    }
    setBusy(true);
    joinByLink(token).then(
      (result) => {
        openGroup(result.groupId);
      },
      (error: { status?: number; code?: string }) => {
        setBusy(false);
        if (error?.status === 429 || error?.code === 'rate_limited') {
          setView(joinLinkViewFor({ failed: true, rateLimited: true }));
          return;
        }
        // Invalid, expired, revoked and full links all read the same: the
        // failure never reveals why. Only an unreachable server keeps the
        // preview with a retry error.
        if (error?.status === 0) {
          setView(
            joinLinkViewFor({
              preview,
              failed: false,
              rateLimited: false,
              joinError: 'Could not join the group. Try again.',
            }),
          );
          return;
        }
        setView(joinLinkViewFor({ failed: true, rateLimited: false }));
      },
    );
  };

  // Opens the group's General topic (same mapping as the topics screen),
  // falling back to the group screen and then the chats list when the
  // refresh has not landed yet. The group id comes from the server's join
  // result (or from the preview when already a member) — never the token.
  const openGroup = (groupId: string | undefined) => {
    if (groupId === undefined) {
      router.replace('/');
      return;
    }
    const general = chats.find(
      (chat) => chat.groupId === groupId && chat.topic?.isGeneral === true,
    );
    const first = chats.find((chat) => chat.groupId === groupId);
    const chatId = general?.id ?? first?.id;
    if (chatId === undefined) {
      router.replace('/');
      return;
    }
    if (general !== undefined) {
      router.replace({ pathname: '/chat/[id]', params: { id: chatId } });
      return;
    }
    router.replace({ pathname: '/group/[id]', params: { id: groupId } });
  };

  return (
    <JoinBackground scheme={scheme}>
      {token === undefined ? (
        <View className="w-full max-w-sm rounded-2xl bg-background p-6 shadow-xl">
          <Text className="text-center text-[24px] font-semibold leading-8 text-foreground">
            This link does not work
          </Text>
        </View>
      ) : (
        <JoinLinkBody view={view} busy={busy} onJoin={join} onCancel={cancel} />
      )}
    </JoinBackground>
  );
}

function JoinBackground({ scheme, children }: { scheme: 'light' | 'dark'; children: ReactNode }) {
  return (
    <View className="flex-1">
      <LinearGradient
        colors={CHAT_BACKGROUND[scheme]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
      />
      <View className="flex-1 items-center justify-center p-4">{children}</View>
    </View>
  );
}
