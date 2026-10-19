import {
  previewUrl,
  splitCodeBlocks,
  splitLinks,
  type UiMessage,
  isMentionOfMe,
  parseLightInline,
  splitMentions,
  type UiMention,
} from '@zilar/chat-core';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Effect, Fiber } from 'effect';
import {
  View,
  type ViewStyle,
  Linking,
  Pressable,
  Text as RNText,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { CodeBlock } from '@/components/chat/markdown-text';
import { DraftCaret, GeneratingLabel, LONG_PRESS_MS } from '@/components/chat/message-bubble-decor';
import { metaTimeText } from '@/components/chat/meta-time';
import { Ticks } from '@/components/chat/ticks';
import { Text } from '@/components/ui/text';
import { API_URL } from '@/lib/auth';
import { makeChatApi, type ChatApi, type LinkPreview } from '@/lib/chat-api';
import { DANGER, FOREGROUND, MUTED_FOREGROUND, SEEN } from '@/lib/colors';
import { well } from '@/lib/depth';
import { safeLinkTarget } from '@/lib/links';
import { getSessionToken } from '@/lib/session-token';
import { useApi } from '@/lib/use-mockable-api';
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

type InlineMetaInput = {
  message: UiMessage;
  outgoing: boolean;
  color: string;
  generating: boolean;
};

// The hidden copy sits in the last line to reserve the meta's width; the visible copy is pinned bottom-right.
export function bubbleMetaTail(meta: InlineMetaInput, reduceMotion: boolean) {
  return (
    <>
      {meta.generating ? <DraftCaret reduceMotion={reduceMotion} /> : null}
      <BubbleInlineMeta {...meta} hidden />
    </>
  );
}

export function bubbleMetaOverlay(meta: InlineMetaInput, textColor: string) {
  return (
    <View style={META_OVERLAY}>
      <Text className="text-[15px] leading-5" color={textColor}>
        <BubbleInlineMeta {...meta} />
      </Text>
    </View>
  );
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
            {bubbleMetaTail({ message, outgoing, color: metaColor, generating }, reduceMotion)}
          </Text>
          {generating ? <GeneratingLabel /> : null}
          {bubbleMetaOverlay({ message, outgoing, color: metaColor, generating }, textColor)}
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
          {bubbleMetaTail({ message, outgoing, color: metaColor, generating }, reduceMotion)}
        </Text>
        {generating ? <GeneratingLabel /> : null}
        {bubbleMetaOverlay({ message, outgoing, color: metaColor, generating }, textColor)}
      </View>
      {url !== undefined ? <LinkPreviewCard url={url} /> : null}
    </>
  );
}

/**
 * Only the `/api/link-preview/image/<key>` prefix ever loads, so a hostile path cannot reach another origin or receive the session token.
 */

const LINK_PREVIEW_IMAGE_PREFIX = '/api/link-preview/image/';

type LinkPreviewImageSource = { uri: string; headers: Record<string, string> };

function useLinkPreviewImage(path: string | undefined): LinkPreviewImageSource | undefined {
  const allowed = path !== undefined && path.startsWith(LINK_PREVIEW_IMAGE_PREFIX);
  const [headers, setHeaders] = useState<Record<string, string> | undefined>(undefined);
  useEffect(() => {
    if (!allowed) {
      return;
    }
    // A cleanup interrupts the read, so a late token never reaches a stale source.
    const fiber = Effect.runFork(
      Effect.tryPromise(() => getSessionToken()).pipe(
        Effect.match({
          onSuccess: (token) => {
            setHeaders(token === undefined ? undefined : { authorization: `Bearer ${token}` });
          },
          onFailure: () => {},
        }),
      ),
    );
    return () => {
      Effect.runSync(Fiber.interrupt(fiber));
    };
  }, [allowed, path]);
  if (!allowed || headers === undefined) {
    return undefined;
  }
  return { uri: `${API_URL}${path}`, headers };
}

type PreviewState =
  { kind: 'loading' } | { kind: 'none' } | { kind: 'ready'; preview: LinkPreview };

const previewCache = new Map<string, LinkPreview | null>();
const previewInFlight = new Map<string, Promise<LinkPreview | null>>();

function loadPreview(api: ChatApi, url: string): Promise<LinkPreview | null> {
  const cached = previewCache.get(url);
  if (cached !== undefined) {
    return Promise.resolve(cached);
  }
  const running = previewInFlight.get(url);
  if (running !== undefined) {
    return running;
  }
  const pending = api.linkPreview === undefined ? undefined : api.linkPreview(url);
  const task = (pending ?? Promise.resolve(null))
    .then((preview) => {
      const value = preview ?? null;
      previewCache.set(url, value);
      return value;
    })
    // A failed call shows no card and is not cached, so a later mount retries.
    .catch(() => null)
    .finally(() => {
      previewInFlight.delete(url);
    });
  previewInFlight.set(url, task);
  return task;
}

// effect-plain: presentational card
function LinkPreviewCard({ url }: { url: string }) {
  const { api } = useApi(makeChatApi);
  const [state, setState] = useState<PreviewState>({ kind: 'loading' });
  // Called before the early return so the hook order stays stable.
  const imageSource = useLinkPreviewImage(state.kind === 'ready' ? state.preview.image : undefined);
  const [brokenImage, setBrokenImage] = useState<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    loadPreview(api, url).then((preview) => {
      if (active) {
        setState(preview === null ? { kind: 'none' } : { kind: 'ready', preview });
      }
    });
    return () => {
      active = false;
    };
  }, [api, url]);

  if (state.kind !== 'ready') {
    return null;
  }

  const { title, description, siteName, image } = state.preview;
  const thumbnail = image !== undefined && image !== brokenImage ? imageSource : undefined;
  const body = (
    <>
      {siteName !== undefined ? (
        <Text
          className="text-[11px] font-medium tracking-wide uppercase"
          color={MUTED_FOREGROUND}
          numberOfLines={1}
        >
          {siteName}
        </Text>
      ) : null}
      {title !== undefined ? (
        <Text
          className="text-[13px] font-semibold leading-snug"
          color={FOREGROUND}
          numberOfLines={1}
        >
          {title}
        </Text>
      ) : null}
      {description !== undefined ? (
        <Text className="text-[12px] leading-snug" color={MUTED_FOREGROUND} numberOfLines={2}>
          {description}
        </Text>
      ) : null}
    </>
  );
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={url}
      onPress={() => {
        const target = safeLinkTarget(url);
        if (target !== undefined) {
          void Linking.openURL(target);
        }
      }}
      className={
        thumbnail !== undefined
          ? 'mt-1.5 flex-row items-start gap-3 rounded-[14px] px-3 py-2 active:opacity-80'
          : 'mt-1.5 gap-0.5 rounded-[14px] px-3 py-2 active:opacity-80'
      }
      style={well}
    >
      {thumbnail !== undefined ? (
        <Image
          recyclingKey={image}
          source={thumbnail}
          onError={() => setBrokenImage(image)}
          className="h-16 w-16 shrink-0 rounded-[14px]"
          contentFit="cover"
        />
      ) : null}
      {thumbnail !== undefined ? <View className="min-w-0 flex-1 gap-0.5">{body}</View> : body}
    </Pressable>
  );
}
