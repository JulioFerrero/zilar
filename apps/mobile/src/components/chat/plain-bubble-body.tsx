import {
  splitCodeBlocks,
  splitLinks,
  type UiMessage,
  isMentionOfMe,
  parseLightInline,
  splitMentions,
  type UiMention,
} from '@zilar/chat-core';
import {
  View,
  type ViewStyle,
  Linking,
  Text as RNText,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { LinkPreviewCard } from '@/components/chat/link-preview-card';
import { CodeBlock } from '@/components/chat/markdown-text';
import { DraftCaret, GeneratingLabel, LONG_PRESS_MS } from '@/components/chat/message-bubble-decor';
import { metaTimeText } from '@/components/chat/meta-time';
import { Ticks } from '@/components/chat/ticks';
import { Text } from '@/components/ui/text';
import { DANGER, FOREGROUND, SEEN } from '@/lib/colors';
import { safeLinkTarget } from '@/lib/links';
import { BODY, INLINE_CODE_BACKGROUND } from './markdown-text';
import { router } from 'expo-router';
import { useOpenMessageMenu } from '@/components/chat/message-menu-context';
import { usePersonRoute } from '@/components/chat/person-pressable';

// A mention chip that opens the person it names when the app can place them: a contact or an existing chat opens its DM, anyone else with a handle opens their profile. A nested RN `Text` cannot sit inside a `Pressable`, so the chip handles its own taps and forwards the bubble's long hold.
function MentionText({
  jid,
  text,
  style,
}: {
  jid: string;
  text: string;
  style?: StyleProp<TextStyle>;
}) {
  const route = usePersonRoute({ jid });
  const openMenu = useOpenMessageMenu();
  if (route === undefined) {
    return <RNText style={style}>{text}</RNText>;
  }
  // The chip swallows the bubble's `onLongPress` once it handles taps, so forward the menu open while a short tap opens the person.
  const longPress =
    openMenu === undefined ? {} : { onLongPress: openMenu, delayLongPress: LONG_PRESS_MS };
  return (
    <RNText
      style={style}
      accessibilityRole="link"
      onPress={() => router.push(route)}
      {...longPress}
    >
      {text}
    </RNText>
  );
}

const CHIP_INCOMING = 'rgba(255,255,255,0.08)';
const CHIP_OUTGOING = 'rgba(0,0,0,0.08)';
const CHIP_ME = 'rgba(255,255,255,0.18)';

/** Chips are flat backgrounds only: nested RN `Text` cannot take a gradient.
 *  Inline code keeps a light text colour, since its background is dark in both
 *  bubble types; the colour is an inline style because the shared `Text` class wins. */
function LinkText({
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

// Pins the visible meta at the bubble's bottom-right; a `hidden` copy in the last line reserves its width, so a short line keeps it inline and a full one wraps to its own right-aligned row.
export const META_OVERLAY: ViewStyle = { position: 'absolute', right: 0, bottom: 0 };

// A fenced code block cannot nest in a `Text` (it is a `View`), so a message with a closed fence renders text blocks as `<Text><LinkText/></Text>` and code blocks with `CodeBlock`; a message without one keeps a single `Text`.

// Not `'transparent'`: Android turns that into 0x00000000, which React Native treats as unset on a nested `Text` span, so it inherits the visible colour. A non-zero alpha (0.004) is invisible but not zero.
const HIDDEN_TEXT_COLOR = 'rgba(0,0,0,0.004)';

// The inline time/edited/ticks meta; a `hidden` copy at the end of the last line reserves its width so it never wraps left.
export function BubbleInlineMeta({
  message,
  outgoing,
  color,
  generating,
  hidden = false,
}: {
  message: UiMessage;
  outgoing: boolean;
  color: string;
  generating: boolean;
  hidden?: boolean;
}) {
  // Only `read` keeps the bright seen colour; earlier states keep the passed meta colour.
  const ticksColor = message.status === 'read' ? SEEN : color;
  // A parent `opacity` does not hide an inline `Text`'s children on Android, so the text uses HIDDEN_TEXT_COLOR and the tick view its own `opacity: 0`.
  const textColor = hidden ? HIDDEN_TEXT_COLOR : color;
  const ticksHidden = hidden || generating;
  return (
    <Text
      className="font-mono text-[11px]"
      color={textColor}
      style={!hidden && generating ? { opacity: 0 } : undefined}
      {...(hidden
        ? {
            accessibilityElementsHidden: true,
            importantForAccessibility: 'no-hide-descendants' as const,
          }
        : {})}
    >
      {'  '}
      {metaTimeText(message)}
      {/* A failed own text names the failure, like the voice and card meta
          does (`BubbleMeta`): a red "Not sent" next to the red alert icon. */}
      {outgoing && message.status === 'failed' ? (
        <>
          {'  '}
          <Text className="font-mono text-[11px]" color={hidden ? HIDDEN_TEXT_COLOR : DANGER}>
            Not sent
          </Text>
        </>
      ) : null}
      {/* A no-break space then a word joiner: the tick
          view stays on the time's line and cannot wrap
          alone onto a second line. */}
      {outgoing ? '\u00a0\u2060' : null}
      {outgoing ? (
        <View
          style={{
            width: 14,
            height: 11,
            // Nudge the ticks down onto the time's baseline.
            transform: [{ translateY: 2 }],
            ...(ticksHidden ? { opacity: 0 } : undefined),
          }}
        >
          <Ticks status={message.status} color={ticksColor} size={11} />
        </View>
      ) : null}
    </Text>
  );
}

// The first https link in the text, unless an image or attachment already fills the bubble; only https is unfurled.
function previewUrl(message: UiMessage, text: string): string | undefined {
  if (message.image !== undefined || message.attachment !== undefined) {
    return undefined;
  }
  for (const segment of splitLinks(text)) {
    if (segment.kind === 'link' && segment.href.startsWith('https://')) {
      return segment.href;
    }
  }
  return undefined;
}

export function PlainBubbleBody({
  message,
  outgoing,
  generating,
  text,
  textColor,
  metaColor,
  reduceMotion,
  meJid,
}: {
  message: UiMessage;
  outgoing: boolean;
  generating: boolean;
  text: string;
  textColor: string;
  metaColor: string;
  reduceMotion: boolean;
  meJid?: string | undefined;
}) {
  const blocks = splitCodeBlocks(text);
  const hasCode = blocks.some((block) => block.kind === 'code');
  const url = previewUrl(message, text);
  if (!hasCode) {
    return (
      <>
        <View>
          <Text className="text-[15px] leading-5" color={textColor}>
            <LinkText
              text={text}
              color={textColor}
              mentions={message.mentions}
              meJid={meJid}
              outgoing={outgoing}
              formatted
            />
            {generating ? <DraftCaret reduceMotion={reduceMotion} /> : null}
            <BubbleInlineMeta
              message={message}
              outgoing={outgoing}
              color={metaColor}
              generating={generating}
              hidden
            />
          </Text>
          {generating ? <GeneratingLabel /> : null}
          <View style={META_OVERLAY}>
            <Text className="text-[15px] leading-5" color={textColor}>
              <BubbleInlineMeta
                message={message}
                outgoing={outgoing}
                color={metaColor}
                generating={generating}
              />
            </Text>
          </View>
        </View>
        {url !== undefined ? <LinkPreviewCard url={url} /> : null}
      </>
    );
  }
  return (
    <>
      {blocks.map((block, index) =>
        block.kind === 'code' ? (
          <View key={index} className="my-1">
            <CodeBlock block={{ type: 'code', value: block.text }} color={FOREGROUND} />
          </View>
        ) : (
          <Text key={index} className="text-[15px] leading-5" color={textColor}>
            <LinkText
              text={block.text}
              color={textColor}
              mentions={(message.mentions ?? []).map((mention) => ({
                ...mention,
                begin: mention.begin - block.start,
                end: mention.end - block.start,
              }))}
              meJid={meJid}
              outgoing={outgoing}
              formatted
            />
          </Text>
        ),
      )}
      <View>
        <Text className="text-[15px] leading-5" color={textColor}>
          {generating ? <DraftCaret reduceMotion={reduceMotion} /> : null}
          <BubbleInlineMeta
            message={message}
            outgoing={outgoing}
            color={metaColor}
            generating={generating}
            hidden
          />
        </Text>
        {generating ? <GeneratingLabel /> : null}
        <View style={META_OVERLAY}>
          <Text className="text-[15px] leading-5" color={textColor}>
            <BubbleInlineMeta
              message={message}
              outgoing={outgoing}
              color={metaColor}
              generating={generating}
            />
          </Text>
        </View>
      </View>
      {url !== undefined ? <LinkPreviewCard url={url} /> : null}
    </>
  );
}
