import { isAiJid, type MentionMember } from '@zilar/chat-core';
import { Pressable, View } from 'react-native';

import { AiBadge } from '@/components/chat/ai-badge';
import { Avatar } from '@/components/chat/avatar';
import { Text } from '@/components/ui/text';

export interface MentionPickerProps {
  members: MentionMember[];
  onSelect: (member: MentionMember) => void;
}

/**
 * The `@` member picker above a group composer (T-0227, the mobile twin of
 * web's `MentionPicker`). Rows are tapped (no hardware-key navigation on the
 * phone); the caller filters and caps the rows.
 */
export function MentionPicker({ members, onSelect }: MentionPickerProps) {
  return (
    <View
      accessibilityRole="list"
      accessibilityLabel="Mention someone"
      className="mb-2 overflow-hidden rounded-[12px] border border-[#262626] bg-surface py-1"
    >
      {members.map((member) => {
        const ai = isAiJid(member.jid);
        const label =
          member.handle === undefined || member.handle === ''
            ? `Mention ${member.name}`
            : `Mention ${member.name} @${member.handle}`;
        return (
          <Pressable
            key={member.jid}
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={() => onSelect(member)}
            className="w-full flex-row items-center gap-2 px-2 py-1.5 active:bg-surface-raised"
          >
            <Avatar id={member.jid} name={member.name} ai={ai} size={28} />
            <Text numberOfLines={1} className="min-w-0 flex-1 text-[14px] text-foreground">
              {member.name}
              {member.handle !== undefined && member.handle !== '' ? (
                <Text className="text-muted-foreground"> @{member.handle}</Text>
              ) : null}
            </Text>
            {ai ? <AiBadge /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}
