import { useRef } from 'react';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { TextInput } from '@/components/ui/text-input';
import { cn } from '@/lib/utils';
import {
  PACK_ACCEPT,
  PrepareBatch,
  type PackEditorItem,
  type PrepareBatchJob,
  type PrepareSticker,
} from './packEditorModel';

export interface PackEditorFormProps {
  title: string;
  onTitleChange: (value: string) => void;
  visibility: 'private' | 'server';
  onVisibilityChange: (value: 'private' | 'server') => void;
  busy: boolean;
  preparing: number;
  batches: PrepareBatchJob[];
  prepare: PrepareSticker;
  onAddFiles: (files: FileList | File[]) => void;
  onPrepared: (item: PackEditorItem) => void;
  onBatchFinished: (key: string) => void;
}

/** The title, visibility, drop zone and the in-flight preparation batches. */
export function PackEditorForm({
  title,
  onTitleChange,
  visibility,
  onVisibilityChange,
  busy,
  preparing,
  batches,
  prepare,
  onAddFiles,
  onPrepared,
  onBatchFinished,
}: PackEditorFormProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="text-[14px] font-medium">Pack name</span>
        <TextInput
          value={title}
          maxLength={60}
          placeholder="My stickers"
          disabled={busy}
          onChange={(event) => onTitleChange(event.target.value)}
        />
      </label>

      <fieldset className="flex flex-col gap-1" disabled={busy}>
        <legend className="text-[14px] font-medium">Who can find this pack</legend>
        <SegmentedControl
          mode="radio"
          ariaLabel="Who can find this pack"
          options={[
            { value: 'private', label: 'Private' },
            { value: 'server', label: 'Shared on this server' },
          ]}
          value={visibility}
          onChange={(next) => {
            if (next !== 'private' && next !== 'server') {
              return;
            }
            onVisibilityChange(next);
          }}
        />
        <p className="text-[13px] text-muted-foreground">
          {visibility === 'server'
            ? 'Shared packs can be found and added by anyone on this server.'
            : 'Only you can find a private pack. Stickers you already sent still show.'}
        </p>
      </fieldset>

      <div
        role="button"
        tabIndex={busy ? -1 : 0}
        aria-label="Add sticker images"
        aria-disabled={busy}
        onClick={() => {
          if (!busy) {
            fileInputRef.current?.click();
          }
        }}
        onKeyDown={(event) => {
          if ((event.key === 'Enter' || event.key === ' ') && !busy) {
            event.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (!busy && event.dataTransfer?.files !== undefined) {
            onAddFiles(event.dataTransfer.files);
          }
        }}
        className={cn(
          'flex flex-col items-center gap-1 rounded-xl border border-dashed border-border-strong bg-well px-4 py-6 text-center',
          busy ? 'cursor-default opacity-60' : 'cursor-pointer',
        )}
      >
        <span className="text-[15px] font-medium">Drop images here or pick files</span>
        <span className="text-[13px] text-muted-foreground">
          PNG, JPEG, WebP or GIF (first frame). Each becomes at most 512 px and 512 KiB.
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept={PACK_ACCEPT}
          multiple
          disabled={busy}
          aria-label="Pick sticker images"
          className="sr-only"
          onChange={(event) => {
            if (event.target.files !== null) {
              onAddFiles(event.target.files);
              event.target.value = '';
            }
          }}
        />
      </div>
      {preparing > 0 && (
        <p className="text-[13px] text-muted-foreground">Preparing {preparing} image…</p>
      )}
      {batches.map((batch) => (
        <PrepareBatch
          key={batch.key}
          files={batch.files}
          prepare={prepare}
          onPrepared={onPrepared}
          onFinished={() => onBatchFinished(batch.key)}
        />
      ))}
    </>
  );
}
