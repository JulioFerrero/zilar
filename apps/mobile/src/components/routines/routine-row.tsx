import { MessageCircle, Pause, Play, Trash2 } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { EntityAvatar } from '@/components/chat/entity-avatar';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { DANGER, ICON } from '@/lib/colors';
import { describeRoutineSchedule } from '@/lib/routines-format';
import type { MyRoutine } from '@/lib/tools-api';
import { cn } from '@/lib/utils';

type RoutineRowProps = {
  routine: MyRoutine;
  /** True while any pause, resume or delete call is in flight. */
  busy: boolean;
  /** True when this row's Delete key is showing. */
  revealed: boolean;
  /** Draw the divider under the row (all but the last of a group). */
  divider: boolean;
  /** Tapping the row toggles its Delete key, like web's RoutineRow. */
  onToggle: () => void;
  /** Opens the chat the routine runs in; the row hides this key without a chat. */
  onAsk: () => void;
  onTogglePause: () => void;
  onAskDelete: () => void;
};

/**
 * One routine in Settings › Routines (T-1720, the phone twin of web's
 * `RoutineRow`): the AI's ball, the title with a status dot (green running,
 * grey paused), one muted line with the schedule in mono and the AI's name,
 * an Ask key that opens the chat and a Pause or Resume key. Tapping the row
 * reveals a red Delete key.
 */
export function RoutineRow({
  routine,
  busy,
  revealed,
  divider,
  onToggle,
  onAsk,
  onTogglePause,
  onAskDelete,
}: RoutineRowProps) {
  const running = routine.status === 'active';
  const chatJid = routine.chatJid;
  return (
    <View
      className={cn(
        'flex-row items-center gap-2 px-3 py-2.5',
        divider && 'border-b border-divider',
      )}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${routine.title}, ${running ? 'running' : 'paused'}`}
        accessibilityState={{ expanded: revealed }}
        onPress={onToggle}
        className="min-w-0 flex-1 flex-row items-center gap-3"
      >
        <EntityAvatar
          person={{
            id: routine.aiId ?? routine.id,
            name: routine.aiName,
            avatarUrl: routine.aiAvatarUrl,
          }}
          size={36}
          ai
        />
        <View className="min-w-0 flex-1 gap-0.5">
          <View className="min-w-0 flex-row items-center gap-2">
            <View
              accessibilityRole="image"
              accessibilityLabel={running ? 'Running' : 'Paused'}
              className={cn(
                'h-2 w-2 shrink-0 rounded-full',
                running ? 'bg-online' : 'bg-muted-foreground',
              )}
            />
            <Text numberOfLines={1} className="text-[15px] font-medium">
              {routine.title}
            </Text>
          </View>
          <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
            <Text className="font-mono">{describeRoutineSchedule(routine.schedule)}</Text>
            {' · '}
            {routine.aiName}
          </Text>
        </View>
      </Pressable>

      {chatJid === null ? null : (
        <IconButton
          label={`Ask ${routine.aiName} about ${routine.title}`}
          disabled={busy}
          onPress={onAsk}
        >
          <MessageCircle size={18} color={ICON} />
        </IconButton>
      )}

      <IconButton
        label={`${running ? 'Pause' : 'Resume'} ${routine.title}`}
        disabled={busy}
        onPress={onTogglePause}
      >
        {running ? <Pause size={18} color={ICON} /> : <Play size={18} color={ICON} />}
      </IconButton>

      {revealed ? (
        <IconButton
          label={`Delete ${routine.title}`}
          className="text-danger"
          disabled={busy}
          onPress={onAskDelete}
        >
          <Trash2 size={18} color={DANGER} />
        </IconButton>
      ) : null}
    </View>
  );
}
