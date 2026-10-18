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
import { MentionText } from './mention-text';
import { BODY, INLINE_CODE_BACKGROUND } from './markdown-text';

const CHIP_INCOMING = 'rgba(255,255,255,0.08)';
const CHIP_OUTGOING = 'rgba(0,0,0,0.08)';
const CHIP_ME = 'rgba(255,255,255,0.18)';

/** Chips are flat backgrounds only: nested RN `Text` cannot take a gradient.
 *  Inline code keeps a light text colour, since its background is dark in both
 *  bubble types; the colour is an inline style because the shared `Text` class wins. */
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
          const style = {
            fontFamily: 'Geist_600SemiBold',
            color: mine ? '#ededed' : undefined,
            backgroundColor: mine ? CHIP_ME : outgoing ? CHIP_OUTGOING : CHIP_INCOMING,
          };
          return mine ? (
            <RNText key={index} style={style}>
              {segment.text}
            </RNText>
          ) : (
            <MentionText key={index} jid={segment.jid} text={segment.text} style={style} />
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
