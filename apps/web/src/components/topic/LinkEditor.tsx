import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import { httpsUrl } from './stripModel';

interface LinkEditorProps {
  href: string | undefined;
  text: string;
  open: boolean;
  url: string;
  label: string;
  onUrlChange: (value: string) => void;
  onLabelChange: (value: string) => void;
  onToggle: () => void;
  onClose: () => void;
  onChange: (url: string | null, label: string | null) => void;
  onError: (message: string) => void;
}

/** The link chip and its URL + label form, validated as an https URL. */
export function LinkEditor({
  href,
  text,
  open,
  url,
  label,
  onUrlChange,
  onLabelChange,
  onToggle,
  onClose,
  onChange,
  onError,
}: LinkEditorProps) {
  const saveLink = (): void => {
    const trimmed = url.trim();
    if (trimmed !== '' && httpsUrl(trimmed) === undefined) {
      onError('Link must be an https URL.');
      return;
    }
    onClose();
    const nextUrl = trimmed === '' ? null : trimmed;
    const nextLabel = label.trim() === '' ? null : label.trim().slice(0, 40);
    onChange(nextUrl, nextLabel);
  };

  return (
    <div className="relative flex shrink-0 items-center">
      {href !== undefined ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[12px] text-muted-foreground hover:bg-surface-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <ExternalLink className="size-3" aria-hidden="true" />
          <span className="max-w-40 truncate">{text}</span>
        </a>
      ) : (
        <button
          type="button"
          aria-label="Add topic link"
          onClick={onToggle}
          className="rounded-full border border-border px-2.5 py-1 text-[12px] text-muted-foreground hover:bg-surface-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {text}
        </button>
      )}
      {href !== undefined && (
        <button
          type="button"
          aria-label="Edit topic link"
          onClick={onToggle}
          className="ml-1 rounded-full px-1.5 py-1 text-[12px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          Edit
        </button>
      )}
      {open && (
        <div className="absolute top-full left-0 z-20 mt-1 flex w-64 flex-col gap-2 rounded-xl border border-border bg-popover p-3 shadow-lg">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium">URL (https only)</span>
            <TextInput
              value={url}
              onChange={(event) => onUrlChange(event.target.value)}
              placeholder="https://…"
              inputMode="url"
              className="rounded-[8px] px-2.5 py-1.5 text-[13px]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium">Label (optional)</span>
            <TextInput
              value={label}
              onChange={(event) => onLabelChange(event.target.value)}
              maxLength={40}
              placeholder="PR #42"
              className="rounded-[8px] px-2.5 py-1.5 text-[13px]"
            />
          </label>
          <div className="flex justify-end gap-1.5">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" variant="default" size="sm" onClick={saveLink}>
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
