import { formatTime, splitCodeBlocks, splitLinks, type UiMessage } from '@zilar/chat-core';
import { View } from 'react-native';

import { LinkPreviewCard } from '@/components/chat/link-preview-card';
import { LinkText } from '@/components/chat/link-text';
import { CodeBlock } from '@/components/chat/markdown-text';
import { DraftCaret, GeneratingLabel } from '@/components/chat/message-bubble-decor';
import { Ticks } from '@/components/chat/ticks';
import { Text } from '@/components/ui/text';
import { DANGER, FOREGROUND, SEEN } from '@/lib/colors';

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

/**
 * The inline time/edited/ticks meta shared by the markdown and plain text
 * branches of a bubble, on the time's own line.
 */
export function BubbleInlineMeta({
  message,
  outgoing,
  color,
  generating,
}: {
  message: UiMessage;
  outgoing: boolean;
  color: string;
  generating: boolean;
}) {
  // Seen ticks render brighter than delivered ones: only `read` keeps the
  // bright seen color, every earlier state keeps the passed meta color.
  const ticksColor = message.status === 'read' ? SEEN : color;
  return (
    <Text
      className="font-mono text-[10px]"
      color={color}
      style={generating ? { opacity: 0 } : undefined}
    >
      {'  '}
      {message.edited === true ? 'edited ' : ''}
      {formatTime(message.createdAt)}
      {/* A failed own text names the failure, like the voice and card meta
          does (`BubbleMeta`): a red "Not sent" next to the red alert icon. */}
      {outgoing && message.status === 'failed' ? (
        <>
          {'  '}
          <Text className="font-mono text-[10px]" color={DANGER}>
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
            ...(generating ? { opacity: 0 } : undefined),
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
          />
        </Text>
        {generating ? <GeneratingLabel /> : null}
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
      <Text className="text-[15px] leading-5" color={textColor}>
        {generating ? <DraftCaret reduceMotion={reduceMotion} /> : null}
        <BubbleInlineMeta
          message={message}
          outgoing={outgoing}
          color={metaColor}
          generating={generating}
        />
      </Text>
      {generating ? <GeneratingLabel /> : null}
      {url !== undefined ? <LinkPreviewCard url={url} /> : null}
    </>
  );
}
