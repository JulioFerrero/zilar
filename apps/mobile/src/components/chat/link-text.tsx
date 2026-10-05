import { isMentionOfMe, splitLinks, splitMentions, type UiMention } from '@zilar/chat-core';
import { Linking, Text as RNText } from 'react-native';

import { safeLinkTarget } from '@/lib/links';

const CHIP_INCOMING = 'rgba(255,255,255,0.08)';
const CHIP_OUTGOING = 'rgba(0,0,0,0.08)';
const CHIP_ME = 'rgba(255,255,255,0.18)';

/**
 * Renders message text: http/https URLs become safe external links and
 * XEP-0372 mention ranges become chips. A mention of the current user gets a
 * stronger background on incoming bubbles. Chips are flat backgrounds only:
 * nested RN `Text` cannot take a gradient.
 *
 * The color, family and size are passed as inline styles on a plain RN `Text`
 * rather than through the shared `Text` component: its class-based default
 * color wins over a color passed across a component boundary on this setup.
 */
export function LinkText({
  text,
  color,
  mentions,
  meJid,
  outgoing = false,
}: {
  text: string;
  color: string;
  mentions?: UiMention[] | undefined;
  meJid?: string | undefined;
  outgoing?: boolean;
}) {
  const segments = splitMentions(text, mentions);

  return (
    <RNText style={{ color, fontFamily: 'Geist_400Regular', fontSize: 15, lineHeight: 20 }}>
      {segments.map((segment, index) => {
        if (segment.kind === 'mention') {
          const mine = !outgoing && isMentionOfMe(segment.jid, meJid);
          return (
            <RNText
              key={index}
              style={{
                fontFamily: 'Geist_600SemiBold',
                color: mine ? '#ededed' : undefined,
                backgroundColor: mine ? CHIP_ME : outgoing ? CHIP_OUTGOING : CHIP_INCOMING,
              }}
            >
              {segment.text}
            </RNText>
          );
        }
        return splitLinks(segment.text).map((linkSegment, linkIndex) =>
          linkSegment.kind === 'link' ? (
            <RNText
              key={`${index}-${linkIndex}`}
              style={{ textDecorationLine: 'underline' }}
              onPress={() => {
                const target = safeLinkTarget(linkSegment.href);
                if (target !== undefined) {
                  void Linking.openURL(target);
                }
              }}
            >
              {linkSegment.text}
            </RNText>
          ) : (
            <RNText key={`${index}-${linkIndex}`}>{linkSegment.text}</RNText>
          ),
        );
      })}
    </RNText>
  );
}
