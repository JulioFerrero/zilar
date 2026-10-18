import { fileExtension } from '@zilar/chat-core';
import { FileText, X } from 'lucide-react';
import { formatFileSize, type PendingAttachment } from '@/lib/attachments';
import { Button } from '../ui/button';
import { Well } from '../ui/well';

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

export function AttachmentStrip({
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
