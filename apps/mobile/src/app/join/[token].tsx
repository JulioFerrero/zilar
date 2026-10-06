import { Redirect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useColorScheme } from 'nativewind';
import { useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { LoadingScreen } from '@/auth/RequireAuth';
import { useSession } from '@/auth/session';
import {
  JoinLinkBody,
  joinLinkViewFor,
  joinPressFailure,
  joinPreviewFailure,
  resolveGroupChat,
  type JoinLinkView,
} from '@/components/chat/join-link';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { CHAT_BACKGROUND } from '@/lib/colors';
import { extractJoinToken } from '@/lib/invite-links-api';
import { useChatStore, useChatStoreApi } from '@/store/chat-store-provider';

/**
 * Join-by-link screen (T-0136): `zilar://join/<token>` (custom scheme,
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
    // Keep the raw param (not the parsed token): a pasted junk token must
    // survive the sign-in and land on the invalid-link state, never on a
    // route that does not exist. `/join` alone matches no route, so a
    // missing param falls back to the chats list.
    const from = raw === undefined ? '/' : `/join/${raw}`;
    return <Redirect href={`/login?from=${encodeURIComponent(from)}`} />;
  }
  if ((me?.name ?? '').trim() === '') {
    return <NameGate raw={raw} />;
  }
  return <Join token={token} />;
}

/** The inline name gate: choose a name first, then return to the join. */
function NameGate({ raw }: { raw: string | undefined }) {
  const router = useRouter();
  const scheme = asColorScheme(useColorScheme().colorScheme);
  // The raw param rides through: a junk token still matches this route's
  // `[token]` segment, so the join screen shows its invalid-link state
  // instead of landing on a route that does not exist. `/join` alone matches
  // no route, so a missing param falls back to the chats list.
  const from = raw === undefined ? '/' : `/join/${raw}`;
  return (
    <JoinBackground scheme={scheme}>
      <View className="w-full max-w-sm rounded-2xl bg-background p-6 shadow-xl">
        <Text className="text-center text-[24px] font-semibold leading-8 text-foreground">
          You are invited
        </Text>
        <Text className="mt-2 text-center text-[15px] text-muted-foreground">
          Choose a display name first — your new group will see it.
        </Text>
        <Button
          accessibilityLabel="Choose a name"
          onPress={() => router.replace(`/welcome/name?from=${encodeURIComponent(from)}` as Href)}
          variant="default"
          size="default"
          className="mt-5"
        >
          <Text>Choose a name</Text>
        </Button>
      </View>
    </JoinBackground>
  );
}

function Join({ token }: { token: string | undefined }) {
  const router = useRouter();
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const previewJoinLink = useChatStore((state) => state.previewJoinLink);
  const joinByLink = useChatStore((state) => state.joinByLink);
  const store = useChatStoreApi();
  // A missing token is invalid from the first render — no effect needed.
  // Junk reads the neutral dead-link message, never the offline retry: the
  // request was never worth making, and the route still matches `[token]`.
  const [view, setView] = useState<JoinLinkView>(
    token === undefined
      ? joinLinkViewFor({ failed: true, rateLimited: false })
      : { state: 'checking' },
  );
  const [busy, setBusy] = useState(false);
  const [retries, setRetries] = useState(0);

  useEffect(() => {
    if (token === undefined) {
      return;
    }
    // The effect only synchronizes with the token and the retry count (the
    // lint rule flags synchronous setState inside effects); the fetch helper
    // resolves the next view, applied once.
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
        // An unreachable server is a retryable connection error, not a dead
        // link (nit 6): only invalid, expired, revoked and full links read
        // the same neutral message. The mapping takes status/code only, so
        // the token never enters the view.
        const failure = joinPreviewFailure(error);
        return joinLinkViewFor({ failed: true, ...failure });
      }
    }
    // `retries` re-runs the load after the offline card's Try again.
  }, [token, previewJoinLink, retries]);

  const cancel = () => {
    router.replace('/');
  };

  const retry = () => {
    setView({ state: 'checking' });
    setRetries((count) => count + 1);
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
        // Invalid, expired, revoked and full links all read the same: the
        // failure never reveals why. Only an unreachable server keeps the
        // preview with a retry error (raw server text never renders).
        setView(joinPressFailure(error, preview));
      },
    );
  };

  // Opens the group's General topic (same mapping as the topics screen),
  // falling back to the group screen and then the chats list when the
  // refresh has not landed yet. The group id comes from the server's join
  // result (or from the preview when already a member) — never the token.
  // Reads the chats fresh at call time: the store refreshes them before the
  // join promise resolves, so a render-time snapshot would never contain
  // the new group and every success would fall through to `/`.
  const openGroup = (groupId: string | undefined) => {
    if (groupId === undefined) {
      router.replace('/');
      return;
    }
    const target = resolveGroupChat(store.getState().chats, groupId);
    if (target.kind === 'chat') {
      router.replace({ pathname: '/chat/[id]', params: { id: target.chatId } });
      return;
    }
    if (target.kind === 'group') {
      router.replace({ pathname: '/group/[id]', params: { id: target.groupId } });
      return;
    }
    router.replace('/');
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
        <JoinLinkBody view={view} busy={busy} onJoin={join} onCancel={cancel} onRetry={retry} />
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
