import type { Attachment } from '@zilar/chat-core';
import { Download, FileText, RotateCcw } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { formatFileSize, safeHttpUrl } from '@/lib/attachments';
import { cn } from '@/lib/utils';

export interface FileMessageProps {
  attachment: Attachment;
  own: boolean;
  /** True while the bytes are still uploading. */
  uploading?: boolean;
  /** True when the upload failed; the card shows a Retry instead of a link. */
  failed?: boolean;
  onRetry?: (() => void) | undefined;
}

/** A file attachment as a raised card: icon, name, size and MIME, and a link. */
export function FileMessage({
  attachment,
  own,
  uploading = false,
  failed = false,
  onRetry,
}: FileMessageProps) {
  const href = safeHttpUrl(attachment.url);
  const meta = failed
    ? 'Upload failed'
    : uploading
      ? 'Uploading…'
      : `${formatFileSize(attachment.size)} · ${attachment.mime}`;

  return (
    <div className="min-w-[210px] max-w-[320px]">
      <div className="raised-pill flex items-center gap-2.5 rounded-[10px] px-2.5 py-2">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-surface">
          <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold" title={attachment.name}>
            {attachment.name}
          </div>
          <div
            className={cn(
              'truncate text-[12px] tabular-nums',
              own ? 'text-bubble-out-meta' : 'text-muted-foreground',
            )}
          >
            {meta}
          </div>
        </div>
        {failed ? (
          <IconButton size={32} radius={8} aria-label="Retry upload" onClick={onRetry}>
            <RotateCcw className="size-4" aria-hidden="true" />
          </IconButton>
        ) : href !== undefined && !uploading ? (
          <a
            href={href}
            download={attachment.name}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Download ${attachment.name}`}
            className="key-icon flex size-8 shrink-0 items-center justify-center rounded-[8px]"
          >
            <Download className="size-4" aria-hidden="true" />
          </a>
        ) : null}
      </div>
    </div>
  );
}
