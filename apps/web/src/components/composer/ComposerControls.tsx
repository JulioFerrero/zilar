import { AttachSendDialog } from '../attach/AttachSendDialog';
import { StickerPanel } from '../StickerPanel';
import { Button } from '../ui/button';
import { IconButton } from '../ui/icon-button';
import { Menu, MenuItem } from '../ui/menu';
import { Well } from '../ui/well';
import { AiBadge } from '../AiBadge';
import type { VoiceRecorderController } from './composerShared';
import { EntityAvatar } from '../EntityAvatar';
import type { ComposerAttachments, SendPendingOptions } from './useComposerAttachments';
import type { Mentions } from './useMentions';
import { type PendingAttachment } from '@/lib/attachments';
import { cn } from '@/lib/utils';
import {
  formatDuration,
  type ReplyRef,
  isAiJid,
  type MentionMember,
  fileExtension,
  formatFileSize,
} from '@zilar/chat-core';
import {
  ArrowUp,
  Mic,
  Send,
  Smile,
  Trash2,
  X,
  Pencil,
  File as FileIcon,
  Image as ImageIcon,
  Paperclip,
  FileText,
} from 'lucide-react';
import { useEffect, type KeyboardEvent, type RefObject, useRef, useState } from 'react';

function EditBar({ text, onCancel }: { text: string; onCancel: () => void }) {
  return (
    <Well className="mb-2 flex items-stretch overflow-hidden rounded-[10px]">
      <span className="w-[3px] shrink-0 bg-[#333333]" aria-hidden="true" />
      <div className="min-w-0 flex-1 px-2.5 py-1.5">
        <div className="flex items-center gap-1.5 truncate text-[13px] leading-4 font-semibold text-[#d4d4d4]">
          <Pencil className="size-3.5 shrink-0" aria-hidden="true" />
          Edit message
        </div>
        <div className="truncate text-[13px] leading-4 text-muted-foreground">{text}</div>
      </div>
      <button
        type="button"
        aria-label="Cancel edit"
        onClick={onCancel}
        className="flex w-9 shrink-0 items-center justify-center text-muted-foreground hover:bg-surface-raised"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </Well>
  );
}

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
  send: (options?: SendPendingOptions) => void;
}

interface MentionPickerProps {
  id: string;
  members: MentionMember[];
  activeIndex: number;
  onSelect: (member: MentionMember) => void;
  onHover: (index: number) => void;
}

/** The `@` picker above a group composer; the textarea keeps focus through `aria-activedescendant`. */
function MentionPicker({ id, members, activeIndex, onSelect, onHover }: MentionPickerProps) {
  return (
    <div
      id={id}
      role="listbox"
      aria-label="Mention someone"
      className="absolute bottom-full left-0 z-30 mb-2 w-[264px] overflow-hidden rounded-[12px] border border-border-strong bg-surface py-1 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.9)]"
    >
      {members.map((member, index) => {
        const ai = isAiJid(member.jid);
        return (
          <button
            key={member.jid}
            id={optionId(member)}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            aria-label={
              member.handle === undefined || member.handle === ''
                ? member.name
                : `${member.name} @${member.handle}`
            }
            // Keep the textarea focused so typing and the keyboard keep working.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(member)}
            onMouseEnter={() => onHover(index)}
            className={cn(
              'flex w-full items-center gap-2 px-2 py-1.5 text-left text-[14px]',
              index === activeIndex ? 'bg-list-hover' : 'hover:bg-list-hover',
            )}
          >
            <EntityAvatar person={{ id: member.jid, name: member.name }} ai={ai} size={28} />
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className="truncate">{member.name}</span>
              {ai && <AiBadge />}
            </span>
            {member.handle !== undefined && member.handle !== '' && (
              <span className="shrink-0 font-mono text-[12px] text-muted-foreground">
                @{member.handle}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function optionId(member: MentionMember): string {
  return `mention-option-${member.jid}`;
}

function AttachMenu({
  onPickMedia,
  onPickFiles,
}: {
  onPickMedia: (files: File[]) => void;
  onPickFiles: (files: File[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const choose = (ref: RefObject<HTMLInputElement | null>): void => {
    setOpen(false);
    ref.current?.click();
  };

  return (
    <div className="relative inline-flex shrink-0">
      <input
        ref={mediaInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(event) => {
          const chosen = event.target.files;
          if (chosen !== null && chosen.length > 0) {
            onPickMedia([...chosen]);
          }
          event.target.value = '';
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          const chosen = event.target.files;
          if (chosen !== null && chosen.length > 0) {
            onPickFiles([...chosen]);
          }
          event.target.value = '';
        }}
      />
      <Menu
        open={open}
        onOpenChange={setOpen}
        label="Attach"
        side="top"
        align="start"
        sideOffset={8}
        trigger={
          <IconButton aria-label="Attach">
            <Paperclip className="size-5" aria-hidden="true" />
          </IconButton>
        }
      >
        <MenuItem icon={ImageIcon} onSelect={() => choose(mediaInputRef)}>
          Photo or video
        </MenuItem>
        <MenuItem icon={FileIcon} onSelect={() => choose(fileInputRef)}>
          File
        </MenuItem>
      </Menu>
    </div>
  );
}

interface AttachmentPreviewProps {
  attachment: PendingAttachment;
  previewUrl?: string | undefined;
  onCancel: () => void;
}

function AttachmentPreview({ attachment, previewUrl, onCancel }: AttachmentPreviewProps) {
  return (
    <Well className="mb-2 flex items-center gap-2.5 rounded-[10px] px-2.5 py-2">
      {attachment.kind === 'image' && previewUrl !== undefined ? (
        <img
          src={previewUrl}
          alt={attachment.file.name}
          className="size-10 shrink-0 rounded-[8px] border border-edge object-cover"
        />
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-[8px] bg-surface">
          <FileText className="size-5 text-muted-foreground" aria-hidden="true" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold">{attachment.file.name}</div>
        <div className="text-[12px] text-muted-foreground">
          {formatFileSize(attachment.file.size)}
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        aria-label="Remove attachment"
        onClick={onCancel}
        className="shrink-0 rounded-[8px] text-muted-foreground"
      >
        <X className="size-4" aria-hidden="true" />
      </Button>
    </Well>
  );
}

function AttachmentStrip({
  attachments,
  previewUrls,
  onRemove,
}: {
  attachments: PendingAttachment[];
  previewUrls: (string | undefined)[];
  onRemove: (index: number) => void;
}) {
  const first = attachments[0];
  if (first === undefined) {
    return null;
  }
  if (attachments.length === 1) {
    return (
      <AttachmentPreview
        attachment={first}
        previewUrl={previewUrls[0]}
        onCancel={() => onRemove(0)}
      />
    );
  }
  return (
    <div className="mb-2 flex gap-2.5 overflow-x-auto pb-1">
      {attachments.map((item, index) => {
        const size = formatFileSize(item.file.size);
        const extension = fileExtension(item.file.name);
        return (
          <div key={`${index}:${item.file.name}`} className="relative shrink-0">
            {item.kind === 'image' && previewUrls[index] !== undefined ? (
              <img
                src={previewUrls[index]}
                alt={item.file.name}
                className="size-[72px] rounded-[10px] border border-edge object-cover"
              />
            ) : (
              <span
                role="img"
                aria-label={`${item.file.name}, ${size}`}
                className="flex size-[72px] flex-col items-center justify-center gap-[3px] rounded-[10px] border border-edge bg-surface"
              >
                <FileText className="size-[18px] text-muted-foreground" aria-hidden="true" />
                {extension !== '' && (
                  <span className="font-mono text-[10px] font-medium text-[#d4d4d4]">
                    {extension}
                  </span>
                )}
                <span className="font-mono text-[10px] text-subtle-foreground">{size}</span>
              </span>
            )}
            <button
              type="button"
              aria-label={`Remove ${item.file.name}`}
              onClick={() => onRemove(index)}
              className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-black/80 text-white"
            >
              <X className="size-[11px]" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
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
  onOpenStickersSettings?: (() => void) | undefined;
  actionError: string | undefined;
}) {
  const { pickerOpen, candidates, activeRow, pickMention, setActiveIndex, pendingCaretRef } =
    mentions;
  const {
    attachments: staged,
    previewUrls,
    removeAttachment,
    attachmentError,
    stickerOpen,
    setStickerOpen,
    attachDialogOpen,
    closeAttachDialog,
    stickerWrapRef,
    acceptFiles,
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
    if (value === '') {
      return;
    }
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
      {staged.length > 0 && !attachDialogOpen && (
        <AttachmentStrip
          attachments={staged}
          previewUrls={previewUrls}
          onRemove={removeAttachment}
        />
      )}
      {(voiceError !== undefined || attachmentError !== undefined) && (
        <div
          className="mb-1 w-fit self-start rounded-[8px] bg-panel px-2 py-1 text-[12px] text-danger"
          role="alert"
        >
          {voiceError ?? attachmentError}
        </div>
      )}
      {voiceError === undefined && attachmentError === undefined && actionError !== undefined && (
        <div
          className="mb-1 w-fit self-start rounded-[8px] bg-panel px-2 py-1 text-[12px] text-danger"
          role="alert"
        >
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
            <AttachMenu
              onPickMedia={(files) => acceptFiles(files, { media: true })}
              onPickFiles={(files) => acceptFiles(files)}
            />
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
              title="**bold**, _italic_, `code`, ``` for a block"
              aria-autocomplete="list"
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
            aria-label={
              isEditing
                ? 'Save edit'
                : staged.length > 1
                  ? `Send ${staged.length} files`
                  : 'Send message'
            }
            onClick={() => (isEditing ? saveEdit() : send())}
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
      {attachDialogOpen && (
        <AttachSendDialog
          attachments={staged}
          previewUrls={previewUrls}
          caption={value}
          onCaptionChange={(next) => onChange(next, next.length)}
          onRemove={removeAttachment}
          error={attachmentError}
          onSend={(asFiles) => send({ asFiles })}
          onClose={closeAttachDialog}
        />
      )}
    </>
  );
}
