import { formatTime, splitCodeBlocks, splitLinks, type UiMessage } from '@zilar/chat-core';
import { View, type ViewStyle } from 'react-native';

import { LinkPreviewCard } from '@/components/chat/link-preview-card';
import { LinkText } from '@/components/chat/link-text';
import { CodeBlock } from '@/components/chat/markdown-text';
import { DraftCaret, GeneratingLabel } from '@/components/chat/message-bubble-decor';
import { Ticks } from '@/components/chat/ticks';
import { Text } from '@/components/ui/text';
import { DANGER, FOREGROUND, SEEN } from '@/lib/colors';

/**
 * Pins the visible meta at the bubble's bottom-right (T-1328). Its width is
 * reserved in the last line by a `hidden` copy of `BubbleInlineMeta`, so a short
 * last line keeps it inline and a full one makes it wrap to its own right-aligned
 * row instead of dropping to the left.
 */
export const META_OVERLAY: ViewStyle = { position: 'absolute', right: 0, bottom: 0 };

/**
 * T-1241: the plain (human message) body moved out of `message-bubble-content`
 * (which was at 400 lines) so the link-preview card can mount here. The move is
 * verbatim except for the card below the text; `BubbleInlineMeta` moved with it
 * because both this body and the markdown branch in `message-bubble-content`
 * use it, and splitting them keeps the two files acyclic.
 *
 * The plain (human message) body: `LinkText` with the light Markdown subset.
 * A fenced code block cannot nest in a `Text` (it is a `View`), so a message
 * with a closed fence renders its blocks in order instead: text blocks as
 * `<Text><LinkText formatted/></Text>` with mention ranges shifted by the
 * block's `start` (out-of-range mentions are ignored by `splitMentions`),
 * code blocks as the shared `CodeBlock` with a light text colour (`FOREGROUND`:
 * the code background is dark in both bubble types), and the inline meta after
 * the last block. A message with no code block keeps the single-`Text` structure.
 */

// The colour for every hidden copy of the meta. It is not `'transparent'`:
// Android turns that into the int 0x00000000, and React Native treats a colour
// of 0 on a nested `Text` span as "unset", so the span inherits the parent's
// visible colour and paints (the hidden time showed twice on the emulator). A
// non-zero alpha (0.004 rounds the alpha byte to 1) is invisible but not zero,
// so the span stays hidden on every platform.
const HIDDEN_TEXT_COLOR = 'rgba(0,0,0,0.004)';

/**
 * The inline time/edited/ticks meta shared by the markdown and plain text
 * branches of a bubble. The visible copy is drawn at the bubble's bottom-right
 * by the branch (see `META_OVERLAY`); a `hidden` copy is placed at the end of the
 * last line to reserve its width, so the meta never wraps to the left.
 */
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
  // Seen ticks render brighter than delivered ones: only `read` keeps the
  // bright seen color, every earlier state keeps the passed meta color.
  const ticksColor = message.status === 'read' ? SEEN : color;
  // The `hidden` copy must reserve the meta's width but never paint. A parent
  // `opacity` does not hide an inline `Text`'s children on Android, so the text
  // uses HIDDEN_TEXT_COLOR and the tick view its own `opacity: 0` instead.
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
      {message.edited === true ? 'edited ' : ''}
      {formatTime(message.createdAt)}
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
            // Nudge the ticks down onto the time's baseline
            // (they otherwise sit about a third too high).
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

// T-1241: the first https link in the text, unless the message carries an image
// or an attachment (those fill the bubble already). Only https is unfurled; the
// server refuses anything else anyway. Mirrors web `MessageTextBody`.
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
