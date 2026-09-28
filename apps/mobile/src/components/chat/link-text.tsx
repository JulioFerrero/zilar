import { splitLinks } from '@galena/chat-core';
import { Linking, Text as RNText } from 'react-native';

import { safeLinkTarget } from '@/lib/links';

/**
 * Renders message text, turning http/https URLs into safe external links.
 *
 * The color, family and size are passed as inline styles on a plain RN `Text`
 * rather than through the shared `Text` component: its class-based default
 * color wins over a color passed across a component boundary on this setup.
 */
export function LinkText({ text, color }: { text: string; color: string }) {
  const segments = splitLinks(text);

  return (
    <RNText style={{ color, fontFamily: 'Geist_400Regular', fontSize: 15, lineHeight: 20 }}>
      {segments.map((segment, index) =>
        segment.kind === 'link' ? (
          <RNText
            key={index}
            style={{ textDecorationLine: 'underline' }}
            onPress={() => {
              const target = safeLinkTarget(segment.href);
              if (target !== undefined) {
                void Linking.openURL(target);
              }
            }}
          >
            {segment.text}
          </RNText>
        ) : (
          <RNText key={index}>{segment.text}</RNText>
        ),
      )}
    </RNText>
  );
}
