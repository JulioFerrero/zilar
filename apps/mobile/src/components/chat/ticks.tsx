import { Check, CheckCheck, Clock } from 'lucide-react-native';
import { View } from 'react-native';

import type { MessageStatus } from '@/lib/types';

type TicksProps = {
  status: MessageStatus;
  color: string;
  size?: number;
};

/** `✓` sent, `✓✓` read, a clock while sending. */
export function Ticks({ status, color, size = 15 }: TicksProps) {
  if (status === 'sending') {
    return <Clock size={size - 2} color={color} />;
  }
  const Icon = status === 'read' ? CheckCheck : Check;
  return (
    <View>
      <Icon size={size} color={color} />
    </View>
  );
}
