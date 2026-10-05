import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

/**
 * The custom role chips next to a member's name (T-0137, the mobile twin of
 * the web `GroupPanel` chips): one muted mono chip per role. Everyone sees
 * the same chips — role membership is not secret.
 */
export function RoleChips({ roles }: { roles: readonly { id: string; name: string }[] }) {
  if (roles.length === 0) {
    return null;
  }
  return (
    <View className="flex-row flex-wrap gap-1">
      {roles.map((role) => (
        <View
          key={role.id}
          accessibilityLabel={`Role ${role.name}`}
          className={cn('rounded-[5px] border border-badge-muted px-1 py-px')}
        >
          <Text className="font-mono text-[10px] leading-[15px] text-muted-foreground">
            {role.name}
          </Text>
        </View>
      ))}
    </View>
  );
}
