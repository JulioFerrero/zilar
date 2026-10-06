import { FileText, X } from 'lucide-react';
import { formatFileSize, type PendingAttachment } from '@/lib/attachments';
import { Button } from './ui/button';
import { Well } from './ui/well';

export interface AttachmentPreviewProps {
  attachment: PendingAttachment;
  /** The object URL of the chosen image, when it has one. */
  previewUrl?: string | undefined;
  onCancel: () => void;
}

/** The pending attachment bar above the composer well, with a thumbnail or icon. */
export function AttachmentPreview({ attachment, previewUrl, onCancel }: AttachmentPreviewProps) {
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
