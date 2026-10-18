import {
  replyQuoteContent,
  senderColor,
  splitLinks,
  type ChatSummary,
  type UiMessage,
  type UiReaction,
} from '@zilar/chat-core';
import { isCardAllowedFrom, fromApi } from '@zilar/client-core';
import { senderAvatarUrl } from '@zilar/client-core/store';
import type { RoutinePost } from '@zilar/protocol';
import { Effect } from 'effect';
import { MoreHorizontal, Repeat } from 'lucide-react';
import {
  lazy,
  memo,
  Suspense,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type RefObject,
} from 'react';
import { Link } from 'react-router';
import { EntityAvatar } from './EntityAvatar';
import { LinkText } from './LinkText';
import { AttachmentBody } from './message/AttachmentBody';
import { BigEmoji, DraftCaret, GeneratingLabel } from './message/BigEmoji';
import { bubbleFlags, draftAnimates } from './message/bubbleFlags';
import { MessageMenuBody, type MessageMenuProps } from './message/MessageMenuBody';
import { MessageMeta, MessageSender } from './message/MessageMeta';
import { hidesBodyText } from './message/QuestionCard';
import { useMessageMenu } from './message/use-message-menu';
import { PersonLink } from './personLink';
import { StickerMessage } from './StickerMessage';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { linkPreview, type LinkPreview } from '@/lib/api/media';
import { useAction } from '@/lib/effect/use-action';
import { scrollToMessage } from '@/lib/scrollToMessage';
import { useSmoothText } from '@/lib/useSmoothText';
import { cn } from '@/lib/utils';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import type { ForwardOrigin } from '@zilar/protocol';
import { Forward } from 'lucide-react';
import { Chip } from './ui/chip';

/** Our own replies keep the accent instead of a sender colour. */
const ACCENT = 'var(--accent)';

function ReplyQuote({ message, onOpen }: { message: UiMessage; onOpen?: () => void }) {
  const quote = message.replyTo;
  // The wire reply carries no name: resolve the target from the loaded history.
  const referenced = useChatSelector((state) =>
    quote === undefined
      ? undefined
      : state.messagesByChat[message.chatId]?.find((item) => item.id === quote.id),
  );
  const currentUserId = useChatSelector((state) => state.currentUserId);
  if (quote === undefined) {
    return null;
  }
  const content = replyQuoteContent(quote, referenced, currentUserId);
  if (content === undefined) {
    return null;
  }
  const color = content.own ? ACCENT : senderColor(content.senderId);

  const block = (
    <>
      <span className="w-[3px] shrink-0" style={{ backgroundColor: color }} aria-hidden="true" />
      <div className="min-w-0 px-2 py-1">
        <div className="truncate text-[13px] leading-4 font-semibold" style={{ color }}>
          {content.senderName}
        </div>
        {content.text !== undefined && (
          <div className="truncate text-[13px] leading-4 text-muted-foreground">{content.text}</div>
        )}
      </div>
    </>
  );

  if (onOpen === undefined) {
    return <div className="mb-1 flex overflow-hidden rounded-md bg-surface/70">{block}</div>;
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Go to the message from ${content.senderName}`}
      className="mb-1 flex w-full overflow-hidden rounded-md bg-surface/70 text-left transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      {block}
    </button>
  );
}

interface ReactionChipsProps {
  reactions: UiReaction[];
  own: boolean;
  className?: string;
  onToggle: (emoji: string) => void;
}

function chipLabel(reaction: UiReaction): string {
  return reaction.mine
    ? `${reaction.emoji} ${reaction.count}, including you`
    : `${reaction.emoji} ${reaction.count}`;
}

function ReactionChips({ reactions, own, className, onToggle }: ReactionChipsProps) {
  if (reactions.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        'mt-1 flex max-w-full flex-wrap gap-1',
        own ? 'justify-end' : 'justify-start',
        className,
      )}
    >
      {reactions.map((reaction) => (
        <Chip
          key={reaction.emoji}
          pressed={reaction.mine}
          ariaLabel={chipLabel(reaction)}
          title={reaction.reactors.join(', ')}
          onClick={() => onToggle(reaction.emoji)}
          className={cn('reaction-chip', reaction.mine && 'reaction-chip-mine')}
        >
          <span aria-hidden="true">{reaction.emoji}</span>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {reaction.count}
          </span>
        </Chip>
      ))}
    </div>
  );
}

function ForwardedHeader({ origin }: { origin: ForwardOrigin }) {
  const label =
    origin.chat_name === undefined
      ? `Forwarded from ${origin.sender_name}`
      : `Forwarded from ${origin.sender_name} in ${origin.chat_name}`;
  return (
    <div className="flex items-center gap-1 text-[12px] italic text-muted-foreground">
      <Forward className="size-3.5" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </div>
  );
}

export { SendFailure } from './message/SendFailure';

/** No known media host (mock store, signed out): every absolute URL is untrusted. */
const EMPTY_HOSTS: ReadonlySet<string> = new Set();

export interface MessageBubbleProps {
  message: UiMessage;
  chat: ChatSummary;
  firstInGroup: boolean;
  lastInGroup: boolean;
  currentUserId: string;
  meJid?: string | undefined;
  onReply: (message: UiMessage) => void;
  onForward?: (message: UiMessage) => void;
  selecting?: boolean;
  selected?: boolean;
  onToggleSelect?: (message: UiMessage) => void;
  onStartSelect?: (message: UiMessage) => void;
  draft?: boolean;
  revealTurnId?: string | undefined;
  pinId?: string | undefined;
}

const INTERACTIVE_SELECTOR = [
  'a',
  'button',
  'input',
  'textarea',
  'select',
  '[role="button"]',
  '[role="switch"]',
  'img',
  'video',
  'audio',
  '[contenteditable="true"]',
].join(', ');

function doubleClickReply(onReply: () => void): (event: MouseEvent) => void {
  return (event) => {
    if ((event.target as HTMLElement).closest(INTERACTIVE_SELECTOR) !== null) {
      return;
    }
    window.getSelection()?.removeAllRanges();
    onReply();
  };
}

export function RoutineHeader({ routine }: { routine: RoutinePost }) {
  return (
    <Link
      to="/settings/routines"
      className="flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
    >
      <Repeat className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{routine.title}</span>
      <span className="shrink-0 font-mono text-[12px]">{routine.schedule}</span>
    </Link>
  );
}

export function MessageTombstone({
  message,
  own,
  showAvatarSlot,
  firstInGroup,
  lastInGroup,
}: {
  message: UiMessage;
  own: boolean;
  showAvatarSlot: boolean;
  firstInGroup: boolean;
  lastInGroup: boolean;
}) {
  return (
    <div
      data-message-id={message.id}
      className={cn(
        'group relative flex items-end gap-1.5',
        own ? 'flex-row-reverse' : 'flex-row',
        firstInGroup ? 'mt-2' : 'mt-0.5',
      )}
    >
      {showAvatarSlot &&
        (lastInGroup ? (
          <EntityAvatar person={{ id: message.senderId, name: message.senderName }} size={34} />
        ) : (
          <span className="w-[34px] shrink-0" aria-hidden="true" />
        ))}
      <div className={cn('flex min-w-0 flex-col', own ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            'tombstone rounded-[14px] px-3 py-1.5 text-[13px] italic',
            own ? 'rounded-br-[4px]' : 'rounded-bl-[4px]',
          )}
        >
          {own ? 'You deleted this message' : 'This message was deleted'}
        </div>
      </div>
    </div>
  );
}

export function MessageActionsButton({
  buttonRef,
  open,
  onOpen,
  beside,
}: {
  buttonRef: RefObject<HTMLButtonElement | null>;
  open: boolean;
  onOpen: () => void;
  beside?: 'left' | 'right' | undefined;
}) {
  return (
    <Button
      ref={buttonRef}
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="Message actions"
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={onOpen}
      className={cn(
        'absolute top-0.5 right-0.5 z-10 size-6 rounded-full bg-surface/80 text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100',
        beside === 'left' && 'top-1/2 right-auto -left-7 -translate-y-1/2',
        beside === 'right' && 'top-1/2 -right-7 -translate-y-1/2',
      )}
    >
      <MoreHorizontal className="size-4" aria-hidden="true" />
    </Button>
  );
}

export function MessageMenu(props: MessageMenuProps) {
  const menu = useMessageMenu();
  if (!props.open && !menu.confirmOpen && !menu.pickerOpen) {
    return null;
  }
  return <MessageMenuBody {...props} menu={menu} />;
}

type PreviewState =
  { kind: 'loading' } | { kind: 'none' } | { kind: 'ready'; preview: LinkPreview };

// effect-plain: presentational card; the api module owns the fetch and cache
export function LinkPreviewCard({ url }: { url: string }) {
  const [state, setState] = useState<PreviewState>({ kind: 'loading' });
  const [brokenImage, setBrokenImage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    linkPreview(url).then((preview) => {
      if (!active) {
        return;
      }
      setState(preview === null ? { kind: 'none' } : { kind: 'ready', preview });
    });
    return () => {
      active = false;
    };
  }, [url]);

  if (state.kind !== 'ready') {
    return null;
  }

  const { title, description, siteName, image } = state.preview;
  const showImage = image !== undefined && image !== brokenImage;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`mx-3 mb-2 ${showImage ? 'flex items-start gap-3' : 'block'} overflow-hidden rounded-[10px] border border-border bg-well px-3 py-2 no-underline`}
    >
      {showImage && (
        <img
          src={image}
          alt=""
          loading="lazy"
          onError={() => setBrokenImage(image ?? null)}
          className="h-16 w-16 shrink-0 rounded-md object-cover"
        />
      )}
      <span className={showImage ? 'block min-w-0 flex-1' : 'block'}>
        {siteName !== undefined && (
          <span className="block truncate text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {siteName}
          </span>
        )}
        {title !== undefined && (
          <span className="mt-0.5 block text-[13px] leading-snug font-semibold text-foreground">
            {title}
          </span>
        )}
        {description !== undefined && (
          <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-muted-foreground">
            {description}
          </span>
        )}
      </span>
    </a>
  );
}

/** The markdown stack loads on the first AI reply; the plain text shows meanwhile. */
const MarkdownText = lazy(() =>
  import('./MarkdownText').then((m) => ({ default: m.MarkdownText })),
);

// Only https is unfurled (the server refuses anything else); a message that
// already carries an image or attachment has no link card.
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

// effect-plain: presentational text body.
export function MessageTextBody({
  message,
  text,
  own,
  generating,
  markdown,
  meJid,
  hasText,
}: {
  message: UiMessage;
  text: string;
  own: boolean;
  generating: boolean;
  markdown: boolean;
  meJid: string | undefined;
  hasText: boolean;
}) {
  const url = hasText ? previewUrl(message, text) : undefined;

  return (
    <>
      {hasText && markdown && (
        <div className={cn('md break-words', own ? 'px-3 py-2' : 'px-3 py-2.5')}>
          <Suspense fallback={<span className="whitespace-pre-wrap">{text}</span>}>
            <MarkdownText text={text} />
          </Suspense>
          <span className="md-tail">
            {generating && <DraftCaret />}
            <MessageMeta
              message={message}
              showTicks={own && !generating}
              edited={message.edited === true}
              className={cn(
                'float-right ml-1.5 translate-y-[4px]',
                own ? 'text-bubble-out-meta' : 'text-bubble-in-meta',
                generating && 'invisible',
              )}
            />
          </span>
        </div>
      )}

      {hasText && !markdown && (
        <p className={cn('break-words whitespace-pre-wrap', own ? 'px-3 py-2' : 'px-3 py-2.5')}>
          <LinkText text={text} mentions={message.mentions} meJid={meJid} formatted />
          {generating && <DraftCaret />}
          <MessageMeta
            message={message}
            showTicks={own && !generating}
            edited={message.edited === true}
            className={cn(
              'float-right ml-1.5 translate-y-[4px]',
              own ? 'text-bubble-out-meta' : 'text-bubble-in-meta',
              generating && 'invisible',
            )}
          />
        </p>
      )}

      {generating && hasText && <GeneratingLabel />}

      {url !== undefined && <LinkPreviewCard url={url} />}
    </>
  );
}

export const MessageBubble = memo(function MessageBubble({
  message,
  chat,
  firstInGroup,
  lastInGroup,
  currentUserId,
  meJid,
  onReply,
  onForward,
  selecting = false,
  selected = false,
  onToggleSelect,
  onStartSelect,
  draft = false,
  revealTurnId,
  pinId,
}: MessageBubbleProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | undefined>(undefined);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const storeApi = useChatStoreApi();
  const mediaTrustedHosts = useChatSelector((s) => s.mediaTrustedHosts);
  const chatId = chat.id;
  const chatCanPin = useChatSelector((s) => s.canPin(chatId));
  const groupMembers = useChatSelector((s) => s.groupInfos[chat.id]?.members);
  const senderAvatar = senderAvatarUrl(message.senderId, chat.topic?.ais, groupMembers);
  const senderPerson = { id: message.senderId, name: message.senderName, avatarUrl: senderAvatar };
  const mediaHosts = mediaTrustedHosts ?? EMPTY_HOSTS;
  const animate = draftAnimates(draft, revealTurnId);
  const { text, done } = useSmoothText(message.text ?? '', {
    animate,
    initial: 'full',
  });
  const {
    own,
    deleted,
    markdown,
    hasText,
    generating,
    transitioning,
    isSending,
    canForward,
    sticker,
    bigEmoji,
    showSender,
    mediaTop,
    attachmentImage,
    gifVideo,
    attachmentFile,
    failed,
    sendFailed,
    imageOnly,
    canEdit,
    canDelete,
    canPin,
  } = bubbleFlags({
    message,
    chat,
    currentUserId,
    firstInGroup,
    draft,
    revealTurnId,
    done,
    mediaHosts,
    chatCanPin,
    now: new Date(),
  });
  const bodyText = hasText && !hidesBodyText(message.card);
  const standaloneCard = message.card?.type === 'progress' || message.card?.type === 'blocks';

  const [, openQuote] = useAction((messageId: string) =>
    Effect.suspend(() =>
      scrollToMessage(messageId)
        ? Effect.void
        : fromApi(() => storeApi.getState().openAtMessage(chatId, messageId)).pipe(
            Effect.tap(() =>
              Effect.sync(() => window.requestAnimationFrame(() => scrollToMessage(messageId))),
            ),
          ),
    ),
  );

  const handleReact = (emoji: string): void => {
    storeApi.getState().react(chat.id, message.id, emoji);
  };

  if (deleted) {
    return (
      <MessageTombstone
        message={message}
        own={own}
        showAvatarSlot={!own && chat.kind === 'group'}
        firstInGroup={firstInGroup}
        lastInGroup={lastInGroup}
      />
    );
  }

  const messageMenu = (
    <MessageMenu
      open={
        menuOpen && !generating && !selecting && (sticker === undefined || message.failed !== true)
      }
      message={message}
      chatId={chatId}
      pinId={pinId}
      menuButtonRef={menuButtonRef}
      canCopy={sticker === undefined && hasText}
      canEdit={sticker === undefined && canEdit}
      canDelete={canDelete}
      canPin={canPin}
      canForward={canForward}
      align={own ? 'right' : 'left'}
      point={menuPoint}
      onReply={() => onReply(message)}
      onForward={() => onForward?.(message)}
      onSelectMessages={() => onStartSelect?.(message)}
      onReact={handleReact}
      onClose={() => setMenuOpen(false)}
    />
  );

  return (
    <div
      data-message-id={message.id}
      data-draft-turn={revealTurnId}
      onContextMenu={
        generating || selecting
          ? undefined
          : (event) => {
              event.preventDefault();
              setMenuPoint({ x: event.clientX, y: event.clientY });
              setMenuOpen(true);
            }
      }
      onClick={
        selecting && !generating && canForward
          ? (event) => {
              if ((event.target as HTMLElement).closest('input[type="checkbox"]') !== null) {
                return;
              }
              onToggleSelect?.(message);
            }
          : undefined
      }
      onDoubleClick={generating || selecting ? undefined : doubleClickReply(() => onReply(message))}
      className={cn(
        'group relative flex items-end gap-1.5',
        own ? 'flex-row-reverse' : 'flex-row',
        firstInGroup ? 'mt-2' : 'mt-0.5',
        isSending && 'animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none',
        selecting && 'cursor-pointer',
      )}
    >
      {selecting && !generating && (
        <span className="flex shrink-0 items-center self-center">
          <Checkbox
            checked={selected}
            disabled={!canForward}
            label="Select message"
            onCheckedChange={() => onToggleSelect?.(message)}
          />
        </span>
      )}
      {!own &&
        chat.kind === 'group' &&
        (lastInGroup ? (
          <PersonLink target={{ jid: message.senderId }} name={message.senderName}>
            <EntityAvatar person={senderPerson} size={34} />
          </PersonLink>
        ) : (
          <span className="w-[34px] shrink-0" aria-hidden="true" />
        ))}
      <div className={cn('flex min-w-0 flex-col', own ? 'items-end' : 'items-start')}>
        {sticker !== undefined ? (
          <div className={cn('relative flex flex-col', own ? 'items-end' : 'items-start')}>
            {showSender && <MessageSender message={message} className="pb-1" />}
            {message.forward !== undefined && (
              <div className="mb-1">
                <ForwardedHeader origin={message.forward} />
              </div>
            )}
            {message.replyTo !== undefined && (
              <div className="mb-1 w-full max-w-[200px]">
                <ReplyQuote message={message} onOpen={() => openQuote(message.replyTo!.id)} />
              </div>
            )}
            <StickerMessage sticker={sticker} message={message} own={own} selecting={selecting} />
            {message.failed === true ? (
              <div className="mt-1.5 flex items-center gap-2 px-0.5 text-[12px] text-danger">
                <span>Send failed</span>
                <button
                  type="button"
                  aria-label="Retry sticker"
                  onClick={() => storeApi.getState().retrySticker(chat.id, message.id)}
                  className="font-semibold underline"
                >
                  Retry
                </button>
              </div>
            ) : (
              !generating &&
              !selecting && (
                <MessageActionsButton
                  buttonRef={menuButtonRef}
                  open={menuOpen}
                  onOpen={() => {
                    setMenuPoint(undefined);
                    setMenuOpen(true);
                  }}
                />
              )
            )}
            {messageMenu}
          </div>
        ) : (
          <div
            data-bubble-look={
              bigEmoji || standaloneCard
                ? undefined
                : own
                  ? 'outgoing'
                  : generating
                    ? 'generating'
                    : 'incoming'
            }
            className={cn(
              'relative flex min-w-0 flex-col',
              own ? 'max-w-[min(520px,100%)]' : 'max-w-[min(560px,100%)]',
              bigEmoji || standaloneCard
                ? undefined
                : cn(
                    'rounded-[14px] bg-clip-padding text-[14px] leading-[1.5]',
                    own ? 'bubble-out' : generating ? 'bubble-gen' : 'bubble-in',
                    transitioning &&
                      'transition-[color,background,box-shadow,border-color] duration-[400ms] ease-out motion-reduce:transition-none',
                    lastInGroup && (own ? 'rounded-br-[4px]' : 'rounded-bl-[4px]'),
                  ),
            )}
          >
            {showSender && <MessageSender message={message} className="px-3 pt-2" />}

            {message.forward !== undefined && (
              <div className="px-3 pt-2">
                <ForwardedHeader origin={message.forward} />
              </div>
            )}

            {message.replyTo !== undefined && (
              <div className="px-3 pt-2">
                <ReplyQuote message={message} onOpen={() => openQuote(message.replyTo!.id)} />
              </div>
            )}

            {message.card?.type === 'routine' &&
              isCardAllowedFrom(message.card, message.senderId) && (
                <div className="px-3 pt-2">
                  <RoutineHeader routine={message.card.data} />
                </div>
              )}

            {bigEmoji ? (
              <BigEmoji message={message} text={text} own={own} generating={generating} />
            ) : (
              <>
                <AttachmentBody
                  message={message}
                  chat={chat}
                  own={own}
                  hasText={bodyText}
                  imageOnly={imageOnly}
                  attachmentImage={attachmentImage}
                  attachmentFile={attachmentFile}
                  gifVideo={gifVideo}
                  sendFailed={sendFailed}
                  failed={failed}
                  isSending={isSending}
                  mediaTop={mediaTop}
                  lastInGroup={lastInGroup}
                />

                <MessageTextBody
                  message={message}
                  text={text}
                  own={own}
                  generating={generating}
                  markdown={markdown}
                  meJid={meJid}
                  hasText={bodyText}
                />
              </>
            )}

            {!generating && !selecting && (
              <MessageActionsButton
                buttonRef={menuButtonRef}
                open={menuOpen}
                onOpen={() => {
                  setMenuPoint(undefined);
                  setMenuOpen(true);
                }}
                beside={bigEmoji ? (own ? 'left' : 'right') : undefined}
              />
            )}
          </div>
        )}

        {sticker === undefined ? messageMenu : null}
        {!generating && message.reactions !== undefined && message.reactions.length > 0 && (
          <ReactionChips reactions={message.reactions} own={own} onToggle={handleReact} />
        )}
      </div>
    </div>
  );
});
