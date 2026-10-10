import { type ReactNode, useEffect } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAction } from '@/lib/effect/use-action';
import type { StickerPack } from '@/lib/api';
import { PackThumbs, VisibilityBadge, thumbsOf } from './PackThumbs';
import {
  type PageSetters,
  addToPanel,
  deletePack,
  removeFromPanel,
  toggleVisibility,
} from './pageActions';

/**
 * A pack I own. Each button has its own action, so two rows (or two buttons)
 * can run at once, while a double click on the same button sends once.
 */
export function MyPackRow({
  pack,
  moving,
  setters,
  onMove,
  onEdit,
  onDelete,
  registerDelete,
}: {
  pack: StickerPack;
  moving: boolean;
  setters: PageSetters;
  onMove: (packId: string, direction: -1 | 1) => void;
  onEdit: (packId: string) => void;
  onDelete: (pack: StickerPack) => void;
  registerDelete: (packId: string, run: () => void) => () => void;
}) {
  const [, runVisibility] = useAction<void, void, never>(() => toggleVisibility(pack, setters));
  const [, runRemove] = useAction<void, void, never>(() => removeFromPanel(pack.id, setters));
  const [, runDelete] = useAction<void, void, never>(() => deletePack(pack.id, setters));
  // The page-level confirm dialog calls this row's own delete action.
  useEffect(() => registerDelete(pack.id, () => runDelete()), [pack.id, registerDelete, runDelete]);
  const importedShareLocked = pack.importedFrom !== undefined;
  const shareReasonId = `share-reason-${pack.id}`;
  const shareButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => runVisibility()}
      disabled={importedShareLocked}
      aria-describedby={importedShareLocked ? shareReasonId : undefined}
    >
      {pack.visibility === 'server' ? 'Make private' : 'Share'}
    </Button>
  );
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
      <PackThumbs thumbs={thumbsOf(pack)} />
      <span className="min-w-0 flex-1 basis-40">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[15px] font-medium">{pack.title}</span>
          <VisibilityBadge
            label={
              pack.importedFrom !== undefined || pack.visibility !== 'server' ? 'Private' : 'Shared'
            }
          />
        </span>
        <span className="mt-0.5 block text-[13px] text-muted-foreground">
          {pack.stickers.length} sticker{pack.stickers.length === 1 ? '' : 's'}
          {pack.importedFrom !== undefined ? ' · Imported from Telegram' : ''}
        </span>
      </span>
      <span className="flex min-w-0 flex-wrap items-center justify-end gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Move ${pack.title} up`}
          title={`Move ${pack.title} up`}
          disabled={moving}
          onClick={() => onMove(pack.id, -1)}
        >
          <ChevronUp aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Move ${pack.title} down`}
          title={`Move ${pack.title} down`}
          disabled={moving}
          onClick={() => onMove(pack.id, 1)}
        >
          <ChevronDown aria-hidden="true" />
        </Button>
        {importedShareLocked ? (
          <span title="Imported packs stay private for personal use" className="inline-flex">
            {shareButton}
            <span id={shareReasonId} className="sr-only">
              Imported packs stay private for personal use
            </span>
          </span>
        ) : (
          shareButton
        )}
        <Button type="button" variant="outline" size="sm" onClick={() => onEdit(pack.id)}>
          Edit
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => runRemove()}>
          Remove from panel
        </Button>
        <Button type="button" variant="destructive" size="sm" onClick={() => onDelete(pack)}>
          Delete
        </Button>
      </span>
    </li>
  );
}

/** The shared thumbnail/title/count row; each caller supplies its own action buttons. */
function PackRowShell({ pack, children }: { pack: StickerPack; children: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
      <PackThumbs thumbs={thumbsOf(pack)} />
      <span className="min-w-0 flex-1 basis-40">
        <span className="block truncate text-[15px] font-medium">{pack.title}</span>
        <span className="mt-0.5 block text-[13px] text-muted-foreground">
          {pack.stickers.length} sticker{pack.stickers.length === 1 ? '' : 's'}
        </span>
      </span>
      {children}
    </li>
  );
}

/** A pack someone else owns that I added to my panel. */
export function AddedPackRow({ pack, setters }: { pack: StickerPack; setters: PageSetters }) {
  const [, runRemove] = useAction<void, void, never>(() => removeFromPanel(pack.id, setters));
  return (
    <PackRowShell pack={pack}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={() => runRemove()}
      >
        Remove
      </Button>
    </PackRowShell>
  );
}

/** A shared pack from the discover search, with its own Add or Remove action. */
export function DiscoverPackRow({
  pack,
  added,
  setters,
}: {
  pack: StickerPack;
  added: boolean;
  setters: PageSetters;
}) {
  const [, runAdd] = useAction<void, void, never>(() => addToPanel(pack.id, setters));
  const [, runRemove] = useAction<void, void, never>(() => removeFromPanel(pack.id, setters));
  return (
    <PackRowShell pack={pack}>
      {added ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => runRemove()}
        >
          Remove
        </Button>
      ) : (
        <Button type="button" size="sm" className="shrink-0" onClick={() => runAdd()}>
          Add
        </Button>
      )}
    </PackRowShell>
  );
}
