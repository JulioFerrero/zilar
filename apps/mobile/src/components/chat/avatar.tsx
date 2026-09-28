import { initials } from '@galena/chat-core';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { avatarShade } from '@/lib/depth';
import { cn } from '@/lib/utils';

type AvatarProps = {
  id: string;
  name: string;
  size?: number;
  online?: boolean;
  /** AIs get the light `#ededed` circle; people and groups a monochrome shade. */
  ai?: boolean;
  className?: string;
};

/** Monochrome circle with initials and the online dot (ui-style.md §2). */
export function Avatar({
  id,
  name,
  size = 54,
  online = false,
  ai = false,
  className,
}: AvatarProps) {
  const shade = avatarShade(id, ai);
  const fontSize = Math.round(size * 0.35);
  const dotSize = Math.max(10, Math.round(size * 0.22));
  return (
    <View className={cn('relative', className)} style={{ width: size, height: size }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: shade.background,
          borderWidth: shade.ring ? 1 : 0,
          borderColor: '#333333',
        }}
      >
        <Text
          className="font-semibold"
          style={{ fontSize, lineHeight: Math.round(fontSize * 1.2), color: shade.color }}
        >
          {initials(name)}
        </Text>
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
