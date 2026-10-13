import { type Attachment, formatFileMeta, isPdfAttachment } from '@zilar/chat-core';
import { ArrowDown, FileText, Loader2, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { IconButton } from '@/components/ui/icon-button';
import { mediaSrc, safeHttpUrl } from '@/lib/attachments';
import { downloadFile, openPdfInNewTab } from '@/lib/open-file';
import { cn } from '@/lib/utils';

export interface FileMessageProps {
  /** The chat JID, required by `GET /api/files`, which checks membership. */
  chatId: string;
  attachment: Attachment;
  own: boolean;
  /** True while the bytes are still uploading. */
  uploading?: boolean;
  /** True when the upload failed; the bubble shows a Retry instead. */
  failed?: boolean;
  onRetry?: (() => void) | undefined;
}

/**
 * A file attachment as a Telegram-style bubble (T-1322, parity with the mobile
 * `file-bubble.tsx`): a round accent circle (a `FileText` document icon for a
 * PDF, a download arrow for any other file, and a spinner while fetching), the
 * file name and "3.9 KB PDF" below. No inner card: the bubble's own surface is
 * the card. Clicking opens a PDF in a new tab through the browser's viewer, and
 * downloads any other file. Saving a PDF is the message menu's Download item
 * (T-1325), so the bubble keeps a single circle like Telegram.
 */
export function FileMessage({
  chatId,
  attachment,
  own,
  uploading = false,
  failed = false,
  onRetry,
}: FileMessageProps) {
  const [opening, setOpening] = useState(false);
  const href =
    safeHttpUrl(attachment.url) === undefined ? undefined : mediaSrc(chatId, attachment.url);
  const pdf = isPdfAttachment(attachment);
  const busy = uploading || opening;
  const canOpen = href !== undefined && !busy && !failed;
  const meta = failed
    ? 'Upload failed'
    : uploading
      ? 'Uploading…'
      : formatFileMeta(attachment.size, attachment.name);

  const open = (): void => {
    if (href === undefined || !canOpen) {
      return;
    }
    if (!pdf) {
      downloadFile(href, attachment.name);
      return;
    }
    setOpening(true);
    openPdfInNewTab(href, attachment.name, () => setOpening(false));
  };

  return (
    <div className="min-w-[210px] max-w-[320px]">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={open}
          disabled={!canOpen}
          aria-label={pdf ? `Open ${attachment.name}` : `Download ${attachment.name}`}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-[10px] text-left active:opacity-80"
        >
          <span
            className={cn(
              'flex size-12 shrink-0 items-center justify-center rounded-full',
              own ? 'bg-bubble-in text-foreground' : 'bg-accent text-accent-foreground',
            )}
          >
            {busy ? (
              <Loader2
                className="size-6 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : pdf ? (
              <FileText className="size-6" aria-hidden="true" />
            ) : (
              <ArrowDown className="size-6" aria-hidden="true" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold" title={attachment.name}>
              {attachment.name}
            </span>
            <span
              className={cn(
                'block truncate text-[12px] tabular-nums',
                own ? 'text-bubble-out-meta' : 'text-muted-foreground',
              )}
            >
              {meta}
            </span>
          </span>
        </button>
        {failed && (
          <IconButton size={32} radius={16} aria-label="Retry upload" onClick={onRetry}>
            <RotateCcw className="size-4" aria-hidden="true" />
          </IconButton>
        )}
      </div>
    </div>
  );
}
