import { Check, CheckCheck, CircleAlert, Clock } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import type { MessageStatus } from '@/lib/types';
import { DANGER } from '@/lib/colors';

type TicksProps = {
  status: MessageStatus;
  color: string;
  size?: number;
};

/** `✓` sent, `✓✓` delivered or read, a clock while sending, a red alert on a failed send. */
export function Ticks({ status, color, size = 15 }: TicksProps) {
  if (status === 'failed') {
    return (
      <TickIcon>
        <CircleAlert size={size - 2} color={DANGER} />
      </TickIcon>
    );
  }
  if (status === 'sending') {
    return (
      <TickIcon>
        <Clock size={size - 2} color={color} />
      </TickIcon>
    );
  }
  const Icon = status === 'read' || status === 'delivered' ? CheckCheck : Check;
  return (
    <TickIcon>
      <Icon size={size} color={color} />
    </TickIcon>
  );
}

/**
 * T-1317: the tick is decoration for the bubble's own `accessibilityLabel`, so
 * it must never be spoken (Android would otherwise read the icon as `￼`). The
 * two props cover both platforms; `accessible={false}` keeps the wrapper out.
 */
function TickIcon({ children }: { children: ReactNode }) {
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {children}
    </View>
  );
}
