import { Check, CheckCheck, CircleAlert, Clock } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { DANGER } from '@/lib/colors';
import type { MessageStatus } from '@zilar/chat-core';

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

// The tick is decoration for the bubble's `accessibilityLabel`, so it must never be spoken (Android would read it as `￼`). `accessible={false}` keeps the wrapper out.
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
