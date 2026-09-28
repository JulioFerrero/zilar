import { Pencil, X } from 'lucide-react';
import { Well } from './ui/well';

/**
 * The composer's edit bar, like the reply bar: it names the action, shows the
 * text being edited and closes with the × key or Escape.
 */
export function EditBar({ text, onCancel }: { text: string; onCancel: () => void }) {
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
