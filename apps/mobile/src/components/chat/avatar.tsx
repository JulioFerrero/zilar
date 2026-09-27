import { avatarGradient, initials } from '@galena/chat-core';
import { LinearGradient } from 'expo-linear-gradient';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

type AvatarProps = {
  id: string;
  name: string;
  size?: number;
  online?: boolean;
  className?: string;
};

/** Gradient circle with initials, plus the green online dot from ui-style.md §4. */
export function Avatar({ id, name, size = 54, online = false, className }: AvatarProps) {
  const gradient = avatarGradient(id);
  const colors = [gradient.from, gradient.to] as const;
  const fontSize = Math.round(size * 0.4);
  const dotSize = Math.max(8, Math.round(size * 0.22));
  return (
    <View className={cn('relative', className)} style={{ width: size, height: size }}>
      <LinearGradient
        colors={colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          className="font-semibold text-white"
          style={{ fontSize, lineHeight: Math.round(fontSize * 1.2) }}
        >
          {initials(name)}
        </Text>
      </LinearGradient>
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
