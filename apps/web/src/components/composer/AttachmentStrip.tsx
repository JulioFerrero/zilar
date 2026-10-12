import { X } from 'lucide-react';
import { formatFileSize, type PendingAttachment } from '@/lib/attachments';
import { AttachmentPreview } from '../AttachmentPreview';

/**
 * The composer's staged attachments (T-1268). One file keeps the earlier
 * single-preview row exactly; several photos show as a horizontal strip of
 * thumbnails, each removable. Pure view: the hook owns the picking.
 */
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
    <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
      {attachments.map((item, index) => (
        <div key={`${index}:${item.file.name}`} className="relative shrink-0">
          {item.kind === 'image' && previewUrls[index] !== undefined ? (
            <img
              src={previewUrls[index]}
              alt={item.file.name}
              className="size-16 rounded-[10px] border border-edge object-cover"
            />
          ) : (
            <span className="flex size-16 items-center justify-center rounded-[10px] border border-edge bg-surface p-1 text-center text-[10px] text-muted-foreground">
              {formatFileSize(item.file.size)}
            </span>
          )}
          <button
            type="button"
            aria-label={`Remove ${item.file.name}`}
            onClick={() => onRemove(index)}
            className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-black/70 text-white"
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
