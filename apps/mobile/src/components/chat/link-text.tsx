import { splitLinks } from '@galena/chat-core';
import { Linking } from 'react-native';

import { Text } from '@/components/ui/text';
import { safeLinkTarget } from '@/lib/links';

/** Renders message text, turning http/https URLs into safe external links. */
export function LinkText({ text }: { text: string }) {
  const segments = splitLinks(text);

  return (
    <Text className="text-[15px] leading-5 text-foreground">
      {segments.map((segment, index) =>
        segment.kind === 'link' ? (
          <Text
            key={index}
            className="text-accent"
            onPress={() => {
              const target = safeLinkTarget(segment.href);
              if (target !== undefined) {
                void Linking.openURL(target);
              }
            }}
          >
            {segment.text}
          </Text>
        ) : (
          <Text key={index}>{segment.text}</Text>
        ),
      )}
    </Text>
  );
}
