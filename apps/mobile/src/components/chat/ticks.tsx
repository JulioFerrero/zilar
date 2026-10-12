import { Check, CheckCheck, CircleAlert, Clock } from 'lucide-react-native';
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
    return <CircleAlert size={size - 2} color={DANGER} />;
  }
  if (status === 'sending') {
    return <Clock size={size - 2} color={color} />;
  }
  const Icon = status === 'read' || status === 'delivered' ? CheckCheck : Check;
  return (
    <View>
      <Icon size={size} color={color} />
    </View>
  );
}
