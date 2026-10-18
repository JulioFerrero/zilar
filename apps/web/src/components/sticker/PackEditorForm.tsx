import { Lock, Globe } from 'lucide-react';
import type { RefObject } from 'react';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { TextInput } from '@/components/ui/text-input';
import { STICKERS_MAX_PER_PACK } from '@zilar/api-contract';
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
  count: number;
  preparing: number;
  batches: PrepareBatchJob[];
  prepare: PrepareSticker;
  onAddFiles: (files: FileList | File[]) => void;
  onPrepared: (item: PackEditorItem) => void;
  onBatchFinished: (key: string) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
}

export function PackEditorForm({
  title,
  onTitleChange,
  visibility,
  onVisibilityChange,
  busy,
  count,
  preparing,
  batches,
  prepare,
  onAddFiles,
  onPrepared,
  onBatchFinished,
  fileInputRef,
}: PackEditorFormProps) {
  return (
    <>
      <div className="flex flex-col gap-3 min-[480px]:flex-row min-[480px]:items-end">
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-[14px] font-medium">Name</span>
          <TextInput
            value={title}
            maxLength={60}
            placeholder="My stickers"
            disabled={busy}
            onChange={(event) => onTitleChange(event.target.value)}
          />
        </label>

        <fieldset disabled={busy} className="w-[220px] shrink-0">
          <SegmentedControl
            mode="radio"
            ariaLabel="Who can find this pack"
            options={[
              { value: 'private', label: 'Private', icon: Lock },
              { value: 'server', label: 'Shared', icon: Globe },
            ]}
            value={visibility}
            onChange={(next) => {
              if (next !== 'private' && next !== 'server') {
                return;
              }
              onVisibilityChange(next);
            }}
          />
        </fieldset>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-[13px] font-medium text-muted-foreground">Stickers</span>
        <span className="font-mono text-[12px] text-subtle-foreground">
          {count} / {STICKERS_MAX_PER_PACK}
        </span>
      </div>

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
