import { writingLabel, type AvatarStackEntry } from '@zilar/chat-core';
import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { AvatarStack } from '@/components/group-info/avatar-stack';
import { Text } from '@/components/ui/text';
import type { GroupDetail } from '@/lib/chat-api';
import { FOREGROUND } from '@/lib/colors';
import { cn } from '@/lib/utils';

const STACK_MAX = 4;
const PULSE_MS = 700;
const DOT_SIZE = 6;

// The person behind one `memberIds` id when the group detail knows them; an unloaded id has no person, but the header still counts it in N.
export function memberPerson(
  memberId: string,
  detail: GroupDetail | undefined,
): AvatarStackEntry | undefined {
  const member = detail?.members.find((entry) => entry.userId === memberId);
  if (member === undefined) {
    return undefined;
  }
  return {
    id: member.userId,
    name: member.name,
    ...(member.avatarUrl === undefined ? {} : { avatarUrl: member.avatarUrl }),
  };
}

type TopicPeopleLineProps = {
  people: readonly AvatarStackEntry[];
  ais: readonly AvatarStackEntry[];
  count: number;
  writers: readonly string[];
  /** The group's name, shown before `· N`; pressable when `onOpenGroup` is set. */
  groupName?: string;
  onOpenGroup?: () => void;
  className?: string;
};

function PulsingDot() {
  const reduceMotion = useReducedMotion();
  const [pulse] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(1);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.25,
          duration: PULSE_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: PULSE_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => {
      animation.stop();
    };
  }, [pulse, reduceMotion]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: DOT_SIZE,
        height: DOT_SIZE,
        borderRadius: DOT_SIZE / 2,
        backgroundColor: FOREGROUND,
        opacity: pulse,
      }}
    />
  );
}

function GroupLine({
  groupName,
  count,
  onOpenGroup,
}: {
  groupName: string | undefined;
  count: number;
  onOpenGroup: (() => void) | undefined;
}) {
  const text = `${groupName === undefined || groupName === '' ? '' : `${groupName} · `}${count}`;
  const label = (
    <Text numberOfLines={1} className="shrink text-[13px] leading-4 text-muted-foreground">
      {text}
    </Text>
  );
  if (groupName === undefined || groupName === '' || onOpenGroup === undefined) {
    return label;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open group ${groupName}`}
      onPress={onOpenGroup}
      hitSlop={{ top: 6, bottom: 4 }}
      className="min-w-0 shrink flex-row items-center"
    >
      {label}
    </Pressable>
  );
}

// The topic header's second line: the stack of the topic's people and AIs with `group · N` when nobody writes, the writers with `writingLabel` and a pulsing dot while someone does. Only this line swaps, so the header height never changes.
export function TopicPeopleLine({
  people,
  ais,
  count,
  writers,
  groupName,
  onOpenGroup,
  className,
}: TopicPeopleLineProps) {
  const all = [...people, ...ais];
  const writing = writers.length > 0;
  const shown = writing
    ? writers
        .slice(0, STACK_MAX)
        .map((name) => all.find((person) => person.name === name) ?? { id: name, name })
    : all.slice(0, STACK_MAX);
  return (
    <View className={cn('h-[22px] min-w-0 flex-row items-center gap-1.5', className)}>
      {shown.length > 0 ? <AvatarStack people={shown} /> : null}
      {writing ? (
        <>
          <Text numberOfLines={1} className="shrink text-[13px] leading-4 text-[#d4d4d4]">
            {writingLabel(writers)}
          </Text>
          <PulsingDot />
        </>
      ) : (
        <GroupLine groupName={groupName} count={count} onOpenGroup={onOpenGroup} />
      )}
    </View>
  );
}
