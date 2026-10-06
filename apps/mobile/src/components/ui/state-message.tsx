import type { LucideIcon } from 'lucide-react-native';
import { CircleAlert, Inbox } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { ActivityIndicator, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { DANGER, MUTED_FOREGROUND } from '@/lib/colors';

export interface StateMessageProps {
  kind: 'empty' | 'loading' | 'error';
  title: string;
  hint?: string;
  icon?: LucideIcon;
  action?: { label: string; onPress: () => void };
  size?: 'block' | 'inline';
}

const ICONS = {
  empty: Inbox,
  error: CircleAlert,
} as const;

/** A centered empty, loading or error message with an optional action. */
export function StateMessage({
  kind,
  title,
  hint,
  icon,
  action,
  size = 'block',
}: StateMessageProps) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const Icon = kind === 'loading' ? undefined : (icon ?? ICONS[kind]);

  if (size === 'inline') {
    return (
      <View
        accessibilityRole={kind === 'error' ? 'alert' : undefined}
        className="flex-row items-center gap-2 px-2 py-1.5"
      >
        {kind === 'loading' ? (
          <ActivityIndicator size="small" color={MUTED_FOREGROUND[scheme]} />
        ) : (
          Icon !== undefined && <Icon size={14} color={MUTED_FOREGROUND[scheme]} />
        )}
        <Text className="text-[13px] text-muted-foreground">{title}</Text>
      </View>
    );
  }

  return (
    <View
      accessibilityRole={kind === 'error' ? 'alert' : undefined}
      className="items-center gap-2 px-6 py-10"
    >
      {kind === 'loading' ? (
        <ActivityIndicator
          size="small"
          color={MUTED_FOREGROUND[scheme]}
          accessibilityLabel={title}
        />
      ) : (
        Icon !== undefined && (
          <Icon size={20} color={kind === 'error' ? DANGER : MUTED_FOREGROUND[scheme]} />
        )
      )}
      <Text className="text-center text-[14px] font-medium">{title}</Text>
      {hint === undefined ? null : (
        <Text className="text-center text-[13px] text-muted-foreground">{hint}</Text>
      )}
      {action === undefined ? null : (
        <Button size="sm" className="mt-1" onPress={action.onPress}>
          <Text>{action.label}</Text>
        </Button>
      )}
    </View>
  );
}
