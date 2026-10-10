import { formatDuration, type ReplyRef } from '@zilar/chat-core';
import { ArrowUp, Mic, Paperclip, Send, Smile, Trash2, X } from 'lucide-react';
import { useEffect, type KeyboardEvent, type RefObject } from 'react';
import { AttachmentPreview } from '../AttachmentPreview';
import { EditBar } from '../EditBar';
import { MentionPicker } from '../MentionPicker';
import { StickerPanel } from '../StickerPanel';
import { Button } from '../ui/button';
import { IconButton } from '../ui/icon-button';
import { Well } from '../ui/well';
import type { ComposerAttachments } from './useComposerAttachments';
import type { Mentions } from './useMentions';
import type { VoiceRecorderController } from './useVoiceRecorder';

const MENTION_PICKER_ID = 'mention-picker';
const LINE_HEIGHT = 22;
const MAX_LINES = 6;

export interface ComposerEditor {
  value: string;
  onChange: (next: string, caret: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  placeholder: string;
  canSend: boolean;
  isEditing: boolean;
  editingText: string;
  onCancelEdit: () => void;
  saveEdit: () => void;
  send: () => void;
}

export function ComposerControls({
  mentions,
  attachments,
  voice,
  editor,
  replyTo,
  onCancelReply,
  onOpenStickersSettings,
  actionError,
}: {
  mentions: Mentions;
  attachments: ComposerAttachments;
  voice: VoiceRecorderController;
  editor: ComposerEditor;
  replyTo: ReplyRef | undefined;
  onCancelReply: () => void;
  /** Opens Settings → Stickers (the panel's "+" tab and Manage link). */
  onOpenStickersSettings?: (() => void) | undefined;
  actionError: string | undefined;
}) {
  const { pickerOpen, candidates, activeRow, pickMention, setActiveIndex, pendingCaretRef } =
    mentions;
  const {
    attachment,
    setAttachment,
    attachmentError,
    stickerOpen,
    setStickerOpen,
    attachmentPreviewUrl,
    fileInputRef,
    stickerWrapRef,
    acceptFile,
    sendSticker,
    sendGif,
  } = attachments;
  const {
    recording,
    locked,
    elapsedMs,
    cancelArmed,
    voiceError,
    cancelRecording,
    finishRecording,
    onMicClick,
    onMicPointerDown,
    onMicPointerCancel,
  } = voice;
  const {
    value,
    onChange,
    onKeyDown,
    textareaRef,
    placeholder,
    canSend,
    isEditing,
    editingText,
    onCancelEdit,
    saveEdit,
    send,
  } = editor;

  useEffect(() => {
    const element = textareaRef.current;
    if (element === null) {
      return;
    }
    element.style.height = 'auto';
    const maxHeight = LINE_HEIGHT * MAX_LINES;
    element.style.height = `${Math.min(Math.max(element.scrollHeight, LINE_HEIGHT), maxHeight)}px`;
  }, [value, textareaRef]);

  return (
    <>
      {pickerOpen && (
        <MentionPicker
          id={MENTION_PICKER_ID}
          members={candidates}
          activeIndex={activeRow}
          onSelect={pickMention}
          onHover={setActiveIndex}
        />
      )}
      {isEditing ? (
        <EditBar text={editingText} onCancel={onCancelEdit} />
      ) : (
        replyTo !== undefined && (
          <Well className="mb-2 flex items-stretch overflow-hidden rounded-[10px]">
            <span className="w-[3px] shrink-0 bg-[#333333]" aria-hidden="true" />
            <div className="min-w-0 flex-1 px-2.5 py-1.5">
              <div className="truncate text-[13px] leading-4 font-semibold text-[#d4d4d4]">
                Reply to {replyTo.senderName}
              </div>
              {replyTo.text !== undefined && (
                <div className="truncate text-[13px] leading-4 text-muted-foreground">
                  {replyTo.text}
                </div>
              )}
            </div>
            <button
              type="button"
              aria-label="Cancel reply"
              onClick={onCancelReply}
              className="flex w-9 shrink-0 items-center justify-center text-muted-foreground hover:bg-surface-raised"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </Well>
        )
      )}
      {attachment !== undefined && (
        <AttachmentPreview
          attachment={attachment}
          previewUrl={attachmentPreviewUrl}
          onCancel={() => setAttachment(undefined)}
        />
      )}
      {(voiceError !== undefined || attachmentError !== undefined) && (
        <div className="mb-1 px-1 text-[12px] text-danger" role="alert">
          {voiceError ?? attachmentError}
        </div>
      )}
      {voiceError === undefined && attachmentError === undefined && actionError !== undefined && (
        <div className="mb-1 px-1 text-[12px] text-danger" role="alert">
          {actionError}
        </div>
      )}
      <Well className="flex items-end gap-2 rounded-[14px] p-2">
        {recording ? (
          <div className="flex h-9 min-w-0 flex-1 items-center gap-3 px-1">
            <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-danger motion-reduce:animate-none" />
            <span className="shrink-0 text-[15px] tabular-nums" aria-live="off">
              {formatDuration(elapsedMs)}
            </span>
            <span className="min-w-0 flex-1 truncate text-center text-[13px] text-muted-foreground">
              {cancelArmed ? 'Release to cancel' : locked ? 'Tap Send to send' : 'Slide to cancel'}
            </span>
            {locked && (
              <IconButton aria-label="Cancel voice message" onClick={cancelRecording} size={36}>
                <Trash2 className="size-5" aria-hidden="true" />
              </IconButton>
            )}
          </div>
        ) : (
          <>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple={false}
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                if (chosen !== undefined) {
                  acceptFile(chosen);
                }
                event.target.value = '';
              }}
            />
            <IconButton aria-label="Attach a file" onClick={() => fileInputRef.current?.click()}>
              <Paperclip className="size-5" aria-hidden="true" />
            </IconButton>
            <textarea
              ref={textareaRef}
              id="message-composer"
              name="message"
              rows={1}
              value={value}
              onChange={(event) => onChange(event.target.value, event.target.selectionStart ?? 0)}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              aria-label="Message"
              aria-autocomplete="list"
              aria-expanded={pickerOpen}
              {...(pickerOpen ? { 'aria-controls': MENTION_PICKER_ID } : {})}
              {...(pickerOpen && candidates[activeRow] !== undefined
                ? { 'aria-activedescendant': `mention-option-${candidates[activeRow].jid}` }
                : {})}
              className="min-h-9 min-w-0 flex-1 resize-none bg-transparent px-1 py-[7px] text-[14px] leading-[22px] outline-none placeholder:text-muted-foreground"
            />
            <span ref={stickerWrapRef} className="inline-flex shrink-0">
              <IconButton
                aria-label="Open sticker panel"
                aria-expanded={stickerOpen}
                onClick={() => setStickerOpen((open) => !open)}
              >
                <Smile className="size-5" aria-hidden="true" />
              </IconButton>
            </span>
            {stickerOpen && (
              <StickerPanel
                onPick={sendSticker}
                onClose={() => setStickerOpen(false)}
                onGifPick={sendGif}
                onManage={() => {
                  setStickerOpen(false);
                  onOpenStickersSettings?.();
                }}
                onCreate={() => {
                  setStickerOpen(false);
                  onOpenStickersSettings?.();
                }}
                onEmoji={(emoji) => {
                  const caret = textareaRef.current?.selectionStart ?? value.length;
                  const next = `${value.slice(0, caret)}${emoji}${value.slice(caret)}`;
                  onChange(next, caret + emoji.length);
                  pendingCaretRef.current = caret + emoji.length;
                  textareaRef.current?.focus();
                }}
              />
            )}
          </>
        )}
        {recording && locked ? (
          <Button
            type="button"
            aria-label="Send voice message"
            onClick={() => finishRecording(false)}
            className="size-9 rounded-[10px] p-0"
          >
            <Send className="size-4" aria-hidden="true" />
          </Button>
        ) : canSend ? (
          <Button
            type="button"
            aria-label={isEditing ? 'Save edit' : 'Send message'}
            onClick={isEditing ? saveEdit : send}
            className="size-9 rounded-[10px] p-0"
          >
            <ArrowUp className="size-4" aria-hidden="true" />
          </Button>
        ) : isEditing ? (
          <Button
            type="button"
            aria-label="Save edit"
            disabled
            className="size-9 rounded-[10px] p-0"
          >
            <ArrowUp className="size-4" aria-hidden="true" />
          </Button>
        ) : (
          <IconButton
            aria-label="Record voice message"
            onClick={onMicClick}
            onPointerDown={onMicPointerDown}
            onPointerCancel={onMicPointerCancel}
          >
            <Mic className="size-5" aria-hidden="true" />
          </IconButton>
        )}
      </Well>
    </>
  );
}
