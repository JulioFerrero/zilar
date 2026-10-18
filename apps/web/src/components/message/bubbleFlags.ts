import {
  canDeleteMessage,
  canEditMessage,
  isBigEmoji,
  shouldRenderMarkdown,
  type ChatSummary,
  type UiMessage,
} from '@zilar/chat-core';
import { isGifVideoAttachment } from '../GifMessage';

export interface BubbleFlagsInput {
  message: UiMessage;
  chat: ChatSummary;
  currentUserId: string;
  firstInGroup: boolean;
  draft: boolean;
  revealTurnId: string | undefined;
  done: boolean;
  mediaHosts: ReadonlySet<string>;
  chatCanPin: boolean;
  now: Date;
}

export function draftAnimates(draft: boolean, revealTurnId: string | undefined): boolean {
  const beyondDraft = revealTurnId !== undefined && !draft;
  return draft || beyondDraft;
}

export function bubbleFlags({
  message,
  chat,
  currentUserId,
  firstInGroup,
  draft,
  revealTurnId,
  done,
  mediaHosts,
  chatCanPin,
  now,
}: BubbleFlagsInput) {
  const own = message.senderId === currentUserId;
  const deleted = message.deleted === true;
  const markdown = shouldRenderMarkdown(chat, message, currentUserId);
  const hasText = message.text !== undefined && message.text.length > 0;
  const beyondDraft = revealTurnId !== undefined && !draft;
  const animate = draft || beyondDraft;
  const generating = draft || (beyondDraft && !done);
  // Keep the 400 ms transition on any bubble that was ever written live, so the
  // change to the normal look fades instead of jumping.
  const transitioning = draft || revealTurnId !== undefined;
  const isSending = own && message.status === 'sending';
  const canForward = !deleted && !isSending && !(own && message.failed === true);
  const sticker =
    message.card !== undefined && message.card.type === 'sticker' ? message.card.data : undefined;
  const bigEmoji =
    hasText &&
    sticker === undefined &&
    message.replyTo === undefined &&
    message.image === undefined &&
    message.voice === undefined &&
    message.attachment === undefined &&
    message.card === undefined &&
    isBigEmoji(message.text ?? '');
  const showSender = !own && chat.kind === 'group' && firstInGroup && !bigEmoji;
  const mediaTop = !showSender && message.forward === undefined && message.replyTo === undefined;
  const attachmentImage = message.attachment?.kind === 'image';
  // GIF-origin videos render inline only on a trusted media URL: the store
  // sanitizer renames untrusted `gif-` attachments first, and this URL check is
  // the second layer, so a hostile absolute URL never auto-loads.
  const gifVideo =
    message.attachment !== undefined &&
    message.attachment.kind === 'file' &&
    isGifVideoAttachment(message.attachment, mediaHosts);
  const attachmentFile = message.attachment?.kind === 'file' && !gifVideo;
  const failed = message.failed === true;
  // The legacy `failed` flag without the status keeps the old rows below, so
  // older bubbles still render.
  const sendFailed = own && message.status === 'failed' && !generating;
  const imageOnly =
    (message.image !== undefined || attachmentImage || gifVideo) &&
    !hasText &&
    message.card === undefined &&
    message.voice === undefined &&
    !attachmentFile;

  // Edit is for my own text messages under 48 h; Delete for everyone is for my
  // own messages of any kind. Pin is for anyone who may pin (DM either side,
  // topic manager) on any loaded message that is not deleted.
  const canEdit =
    !generating &&
    !deleted &&
    message.attachment === undefined &&
    canEditMessage(message, currentUserId, now);
  const canDelete = !generating && !deleted && canDeleteMessage(message, currentUserId);
  const canPin = !generating && !deleted && chatCanPin;

  return {
    own,
    deleted,
    markdown,
    hasText,
    beyondDraft,
    animate,
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
  };
}
