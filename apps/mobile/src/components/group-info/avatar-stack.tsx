import { palette } from '@zilar/ui-tokens';
import { View } from 'react-native';

import { EntityAvatar } from '@/components/chat/entity-avatar';

/** The 22 px stack circle, its ring and the board's 7 px overlap. */
const STACK_SIZE = 22;
const STACK_RING = 2;
const STACK_OVERLAP = -7;

export type StackPerson = { id: string; name: string; avatarUrl?: string | undefined };

export function AvatarStack({ people }: { people: readonly StackPerson[] }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="flex-row items-center"
    >
      {people.map((person, index) => (
        <View
          key={person.id}
          style={{
            width: STACK_SIZE,
            height: STACK_SIZE,
            borderRadius: STACK_SIZE / 2,
            borderWidth: STACK_RING,
            borderColor: palette.surface,
            overflow: 'hidden',
            marginLeft: index === 0 ? 0 : STACK_OVERLAP,
          }}
        >
          <EntityAvatar
            person={{
              id: person.id,
              name: person.name,
              ...(person.avatarUrl === undefined ? {} : { avatarUrl: person.avatarUrl }),
            }}
            size={STACK_SIZE - STACK_RING * 2}
          />
        </View>
      ))}
    </View>
  );
}
