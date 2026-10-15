import { FileText, Film, X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import type { PendingAttachment } from '@/lib/attachments';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Dialog } from '../ui/dialog';
import { Well } from '../ui/well';

const isVideo = (file: File): boolean => file.type.startsWith('video/');

/** The dialog title, Telegram-style: the count and the kind of the pick. */
function titleFor(attachments: PendingAttachment[]): string {
  const first = attachments[0];
  if (first === undefined) {
    return 'Send';
  }
  if (attachments.length > 1) {
    const everyImage = attachments.every((item) => item.kind === 'image');
    return everyImage ? `Send ${attachments.length} Photos` : `Send ${attachments.length} Files`;
  }
  if (first.kind === 'image') {
    return 'Send Photo';
  }
  return isVideo(first.file) ? 'Send Video' : 'Send File';
}

/** One removable preview: a thumbnail when the item has one, an icon otherwise. */
function PreviewTile({
  attachment,
  previewUrl,
  large,
  onRemove,
}: {
  attachment: PendingAttachment;
  previewUrl: string | undefined;
  large: boolean;
  onRemove: () => void;
}) {
  const showsImage = attachment.kind === 'image' && previewUrl !== undefined;
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[10px] border border-edge bg-surface',
        large ? 'mx-auto max-h-[300px] w-fit' : 'aspect-square',
      )}
    >
      {showsImage ? (
        <img
          src={previewUrl}
          alt={attachment.file.name}
          className={cn('object-cover', large ? 'max-h-[300px]' : 'size-full')}
        />
      ) : (
        <div className="flex min-h-24 size-full flex-col items-center justify-center gap-1.5 p-3 text-center">
          {isVideo(attachment.file) ? (
            <Film className="size-6 text-muted-foreground" aria-hidden="true" />
          ) : (
            <FileText className="size-6 text-muted-foreground" aria-hidden="true" />
          )}
          <span className="line-clamp-2 text-[11px] break-all text-muted-foreground">
            {attachment.file.name}
          </span>
        </div>
      )}
      <button
        type="button"
        aria-label={`Remove ${attachment.file.name}`}
        onClick={onRemove}
        className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      >
        <X className="size-3" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * The send dialog for a media pick (T-1324): a grid of previews (a single
 * large one when there is one), each removable, a caption prefilled from the
 * composer, and "Send as files". Send hands the caption and the pick to the
 * composer's existing send path; Escape cancels, Enter sends.
 */
export function AttachSendDialog({
  attachments,
  previewUrls,
  caption,
  onCaptionChange,
  onRemove,
  error,
  onSend,
  onClose,
}: {
  attachments: PendingAttachment[];
  previewUrls: (string | undefined)[];
  caption: string;
  onCaptionChange: (next: string) => void;
  onRemove: (index: number) => void;
  error: string | undefined;
  onSend: (asFiles: boolean) => void;
  onClose: () => void;
}) {
  const [asFiles, setAsFiles] = useState(false);
  const first = attachments[0];

  const send = (): void => {
    if (attachments.length > 0) {
      onSend(asFiles);
    }
  };

  const onCaptionKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={titleFor(attachments)}
      ariaLabel="Send attachments"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
      {...(error === undefined ? {} : { error })}
      actions={
        <Button type="submit" disabled={attachments.length === 0}>
          Send
        </Button>
      }
    >
      {attachments.length === 0 ? (
        <p className="mt-3 text-[14px] text-muted-foreground">Nothing selected.</p>
      ) : (
        <div className="mt-3">
          {first !== undefined && attachments.length === 1 ? (
            <PreviewTile
              attachment={first}
              previewUrl={previewUrls[0]}
              large
              onRemove={() => onRemove(0)}
            />
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {attachments.map((item, index) => (
                <PreviewTile
                  key={`${index}:${item.file.name}`}
                  attachment={item}
                  previewUrl={previewUrls[index]}
                  large={false}
                  onRemove={() => onRemove(index)}
                />
              ))}
            </div>
          )}
          <Well className="mt-3 rounded-[10px] px-2 py-1.5">
            <textarea
              data-autofocus
              value={caption}
              onChange={(event) => onCaptionChange(event.target.value)}
              onKeyDown={onCaptionKeyDown}
              placeholder="Add a caption…"
              aria-label="Caption"
              rows={2}
              className="min-h-9 w-full resize-none bg-transparent px-1 py-[7px] text-[14px] leading-[22px] outline-none placeholder:text-muted-foreground"
            />
          </Well>
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-[14px]">
            <Checkbox checked={asFiles} onCheckedChange={setAsFiles} />
            Send as files
          </label>
        </div>
      )}
    </Dialog>
  );
}
