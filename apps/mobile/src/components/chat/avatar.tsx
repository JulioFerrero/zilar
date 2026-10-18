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
  seed: string;
  name: string;
  size?: number;
  online?: boolean;
  avatarUrl?: string;
  ai?: boolean;
  className?: string;
};

/** The picture renders over the ball avatar, which returns on load error. The
 *  bearer rides only to the API origin, and a late token never reaches it. */
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
  // A relative server path needs the bearer, so the picture waits for the token.
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
