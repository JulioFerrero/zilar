import { avatarSvg } from '@zilar/chat-core';
import { Effect, Fiber } from 'effect';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { avatarImageSource } from '@/components/settings/profile-logic';
import { API_URL } from '@/lib/auth';
import { getSessionToken } from '@/lib/session-token';
import { cn } from '@/lib/utils';

type AvatarProps = {
  /** The orb seed, already normalized by `avatarIdentity`. */
  seed: string;
  /** The display name, for the picture's accessibility label. */
  name: string;
  size?: number;
  online?: boolean;
  /**
   * T-1192 (MUX-12): the person's or group's picture. Absent (or failed to
   * load) shows the ball avatar instead.
   */
  avatarUrl?: string;
  /** Kept for callers; the ball avatar no longer changes for AIs. */
  ai?: boolean;
  className?: string;
};

/**
 * The avatar circle and the online dot.
 *
 * T-1192 (MUX-12): when `avatarUrl` is set the picture renders on top of the
 * ball avatar, which stays behind as the placeholder and comes back on load
 * error. The bearer rides only to the API origin (`avatarImageSource`). The
 * token is read the way the profile avatar does (`use-profile-avatar.ts`
 * loads `getSessionToken()` into state), here with the fiber the chat media
 * loaders use so a late token or an unmount never reaches a stale avatar.
 */
export function Avatar({
  seed,
  name,
  size = 54,
  online = false,
  avatarUrl,
  className,
}: AvatarProps) {
  const dotSize = Math.max(10, Math.round(size * 0.22));
  const hasUrl = avatarUrl !== undefined && avatarUrl !== '';
  const [token, setToken] = useState<string | undefined>(undefined);
  // The failed url, not a flag: a fresh `avatarUrl` clears it (profile-view.tsx).
  const [failedUrl, setFailedUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!hasUrl) {
      return;
    }
    // A cleanup interrupts the read, so a late token never reaches a stale avatar.
    const fiber = Effect.runFork(
      Effect.tryPromise(() => getSessionToken()).pipe(
        Effect.match({
          onSuccess: (value) => {
            setToken(value);
          },
          onFailure: () => {},
        }),
      ),
    );
    return () => {
      Effect.runSync(Fiber.interrupt(fiber));
    };
  }, [hasUrl]);
  const imageFailed = failedUrl !== undefined && failedUrl === avatarUrl;
  // A relative server path (`/api/avatars/<id>`) needs the bearer, so the
  // picture waits for the token; the ball shows until then.
  const source =
    hasUrl && !imageFailed && token !== undefined
      ? avatarImageSource(avatarUrl, API_URL, token)
      : null;
  return (
    <View className={cn('relative', className)} style={{ width: size, height: size }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: 'hidden',
        }}
      >
        <SvgXml xml={avatarSvg(seed)} width={size} height={size} />
        {source !== null ? (
          <Image
            source={source}
            accessibilityLabel={`${name} picture`}
            style={{ position: 'absolute', width: size, height: size }}
            contentFit="cover"
            onError={() => setFailedUrl(avatarUrl)}
          />
        ) : null}
      </View>
      {online ? (
        <View
          className="absolute border-2 border-background bg-online"
          style={{
            right: 0,
            bottom: 0,
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
          }}
        />
      ) : null}
    </View>
  );
}
