import type { RoutinePost } from '@zilar/protocol';
import { useRouter } from 'expo-router';
import { Repeat } from 'lucide-react-native';
import { Pressable } from 'react-native';

import { Text } from '@/components/ui/text';
import { MUTED_FOREGROUND } from '@/lib/colors';

// The header a routine's live message shows above its text: a repeat icon, the routine title and its schedule. The row opens Settings › Routines.
export function RoutineHeader({ routine }: { routine: RoutinePost }) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Routines: ${routine.title}, ${routine.schedule}`}
      onPress={() => router.push('/settings/routines')}
      className="mb-1 min-h-6 flex-row items-center gap-2"
    >
      <Repeat size={14} color={MUTED_FOREGROUND} />
      <Text numberOfLines={1} className="shrink text-[13px] font-medium text-muted-foreground">
        {routine.title}
      </Text>
      <Text className="ml-auto shrink-0 font-mono text-[12px] text-muted-foreground">
        {routine.schedule}
      </Text>
    </Pressable>
  );
}
