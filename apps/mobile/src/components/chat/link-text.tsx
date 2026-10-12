import {
  isMentionOfMe,
  parseLightInline,
  splitLinks,
  splitMentions,
  type UiMention,
} from '@zilar/chat-core';
import { Linking, Text as RNText } from 'react-native';

import { safeLinkTarget } from '@/lib/links';
import { FOREGROUND } from '@/lib/colors';
import { BODY, INLINE_CODE_BACKGROUND } from './markdown-text';

const CHIP_INCOMING = 'rgba(255,255,255,0.08)';
const CHIP_OUTGOING = 'rgba(0,0,0,0.08)';
const CHIP_ME = 'rgba(255,255,255,0.18)';

/**
 * Renders message text: http/https URLs become safe external links and
 * XEP-0372 mention ranges become chips. A mention of the current user gets a
 * stronger background on incoming bubbles. Chips are flat backgrounds only:
 * nested RN `Text` cannot take a gradient.
 *
 * With `formatted`, the light Markdown subset also applies (`**bold**`,
 * `*italics*`, `` `inline code` ``; fenced blocks are split by the caller),
 * mirroring web `LinkText`. The body, bold, italic and inline-code looks come
 * from `markdown-text.tsx` (`BODY`, `CODE`, `INLINE_CODE_BACKGROUND`,
 * `:14-20`): the root text spreads `BODY`, bold/italic match its
 * `renderInline`, and inline code uses its font, background and radius with
 * a light text colour (`FOREGROUND` from `@/lib/colors`): the code background
 * is dark in both bubble types, so the bubble's text colour would be
 * unreadable on it. Fenced blocks render with the shared `CodeBlock`
 * (imported by the caller, passed the same light colour).
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
  formatted = false,
}: {
  text: string;
  color: string;
  mentions?: UiMention[] | undefined;
  meJid?: string | undefined;
  outgoing?: boolean;
  formatted?: boolean | undefined;
}) {
  const segments = splitMentions(text, mentions);

  return (
    <RNText style={[BODY, { color }]}>
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
          ) : formatted ? (
            <RNText key={`${index}-${linkIndex}`}>
              {parseLightInline(linkSegment.text).map((inline, inlineIndex) =>
                inline.kind === 'bold' ? (
                  <RNText key={inlineIndex} style={{ fontFamily: 'Geist_600SemiBold' }}>
                    {inline.text}
                  </RNText>
                ) : inline.kind === 'italic' ? (
                  <RNText key={inlineIndex} style={{ fontStyle: 'italic' }}>
                    {inline.text}
                  </RNText>
                ) : inline.kind === 'code' ? (
                  <RNText
                    key={inlineIndex}
                    style={{
                      fontFamily: 'GeistMono_400Regular',
                      color: FOREGROUND,
                      backgroundColor: INLINE_CODE_BACKGROUND,
                      borderRadius: 3,
                      paddingHorizontal: 3,
                    }}
                  >
                    {inline.text}
                  </RNText>
                ) : (
                  inline.text
                ),
              )}
            </RNText>
          ) : (
            <RNText key={`${index}-${linkIndex}`}>{linkSegment.text}</RNText>
          ),
        );
      })}
    </RNText>
  );
}
