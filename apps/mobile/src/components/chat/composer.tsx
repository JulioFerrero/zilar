import { Mic, Paperclip, Send, Smile } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/ui/icon-button';
import { asColorScheme } from '@/lib/color-scheme';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { cn } from '@/lib/utils';
import { useColorScheme } from 'nativewind';

const MIN_INPUT_HEIGHT = 36;
const MAX_INPUT_HEIGHT = 132;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Bottom composer: attach, auto-growing input, emoji, and mic/send button. */
export function Composer({ onSend }: { onSend: (text: string) => void }) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [inputHeight, setInputHeight] = useState(MIN_INPUT_HEIGHT);
  const canSend = text.trim().length > 0;
  const mutedColor = MUTED_FOREGROUND[scheme];

  const handleSend = () => {
    if (!canSend) {
      return;
    }
    onSend(text);
    setText('');
    setInputHeight(MIN_INPUT_HEIGHT);
  };

  return (
    <View
      className="flex-row items-end gap-2 px-2 pt-1.5"
      style={{ paddingBottom: Math.max(insets.bottom, 8) }}
    >
      <View className="flex-1 flex-row items-end rounded-3xl bg-background px-1 py-1">
        <IconButton label="Attach file">
          <Paperclip size={22} color={mutedColor} />
        </IconButton>
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          placeholder="Message"
          placeholderTextColor={mutedColor}
          accessibilityLabel="Message"
          className="mx-1 flex-1 py-2 text-[16px] text-foreground"
          style={{ height: inputHeight, maxHeight: MAX_INPUT_HEIGHT, lineHeight: 20 }}
          onContentSizeChange={(event) =>
            setInputHeight(
              clamp(
                Math.round(event.nativeEvent.contentSize.height) + 16,
                MIN_INPUT_HEIGHT,
                MAX_INPUT_HEIGHT,
              ),
            )
          }
        />
        <IconButton label="Emoji">
          <Smile size={22} color={mutedColor} />
        </IconButton>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={canSend ? 'Send' : 'Record voice message'}
        onPress={canSend ? handleSend : undefined}
        className={cn(
          'mb-0.5 h-[56px] w-[56px] items-center justify-center rounded-full bg-accent',
          canSend ? 'active:bg-accent/90' : 'opacity-100',
        )}
      >
        {canSend ? <Send size={22} color="#ffffff" /> : <Mic size={22} color="#ffffff" />}
      </Pressable>
    </View>
  );
}
