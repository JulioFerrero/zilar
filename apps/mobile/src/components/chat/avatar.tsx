import { avatarSvg } from '@zilar/chat-core';
import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { cn } from '@/lib/utils';

type AvatarProps = {
  id: string;
  name: string;
  size?: number;
  online?: boolean;
  /** Kept for callers; the ball avatar no longer changes for AIs. */
  ai?: boolean;
  className?: string;
};

/** The ball avatar circle and the online dot. */
export function Avatar({ id, size = 54, online = false, className }: AvatarProps) {
  const dotSize = Math.max(10, Math.round(size * 0.22));
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
        <SvgXml xml={avatarSvg(id)} width={size} height={size} />
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
