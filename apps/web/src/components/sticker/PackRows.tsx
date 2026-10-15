import { useEffect } from 'react';
import { Link } from 'react-router';
import { Check, CircleMinus, Globe, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { SortableHandle, SortableItem } from '@/components/ui/sortable-list';
import { useAction } from '@/lib/effect/use-action';
import type { StickerPack } from '@/lib/api';
import { PackThumbs, thumbsOf } from './PackThumbs';
import { PackMenu } from './PackMenu';
import { type PageSetters, addToPanel, deletePack, removeFromPanel } from './pageActions';

// One row of the shared list card: the rows sit inside a
// `rounded-xl border border-border bg-surface` container and divide themselves.
const ROW_CLASS = 'flex items-center gap-3 border-b border-divider px-3 py-2.5 last:border-b-0';
const THUMB_SIZE = 36;

function countLabel(pack: StickerPack): string {
  const count = pack.stickers.length;
  return `${count} sticker${count === 1 ? '' : 's'}`;
}

/** The name (with the shared globe), the count line and room for one action. */
function PackRowText({ pack, shared, meta }: { pack: StickerPack; shared: boolean; meta: string }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-1.5">
        <Link
          to={`/stickers/${pack.id}`}
          className="min-w-0 truncate text-[14px] font-semibold hover:underline"
        >
          {pack.title}
        </Link>
        {shared && (
          <Globe
            className="size-[13px] shrink-0 text-muted-foreground"
            role="img"
            aria-label="Shared"
          />
        )}
      </span>
      <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">{meta}</span>
    </span>
  );
}

/**
 * A pack I own. The grip starts the drag (pointer, touch or keyboard); the
 * row's own menu stays clickable. Its delete action is registered so the
 * page's one confirm dialog can run it.
 */
export function MyPackRow({
  pack,
  disabled,
  setters,
  onEdit,
  onDelete,
  registerDelete,
}: {
  pack: StickerPack;
  disabled: boolean;
  setters: PageSetters;
  onEdit: (packId: string) => void;
  onDelete: (pack: StickerPack) => void;
  registerDelete: (packId: string, run: () => void) => () => void;
}) {
  const [, runDelete] = useAction<void, void, never>(() => deletePack(pack.id, setters));
  useEffect(() => registerDelete(pack.id, () => runDelete()), [pack.id, registerDelete, runDelete]);
  return (
    <SortableItem id={pack.id} disabled={disabled} className={ROW_CLASS}>
      {({ attributes, listeners, setActivatorNodeRef, isDragging }) => (
        <>
          <SortableHandle
            attributes={attributes}
            listeners={listeners}
            setActivatorNodeRef={setActivatorNodeRef}
            isDragging={isDragging}
            label={`Drag ${pack.title} to reorder`}
            disabled={disabled}
          />
          <PackThumbs thumbs={thumbsOf(pack)} size={THUMB_SIZE} />
          <PackRowText pack={pack} shared={pack.visibility === 'server'} meta={countLabel(pack)} />
          <PackMenu pack={pack} setters={setters} onEdit={onEdit} onDelete={onDelete} />
        </>
      )}
    </SortableItem>
  );
}

/** A pack someone else owns that I added to my panel; no grip, remove only. */
export function AddedPackRow({ pack, setters }: { pack: StickerPack; setters: PageSetters }) {
  const [, runRemove] = useAction<void, void, never>(() => removeFromPanel(pack.id, setters));
  return (
    <li className={ROW_CLASS}>
      <PackThumbs thumbs={thumbsOf(pack)} size={THUMB_SIZE} />
      <PackRowText pack={pack} shared={false} meta={countLabel(pack)} />
      <IconButton aria-label={`Remove ${pack.title} from panel`} onClick={() => runRemove()}>
        <CircleMinus className="size-4" aria-hidden="true" />
      </IconButton>
    </li>
  );
}

/** A shared pack from the discover search, with its own Add or in-panel state. */
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
    <li className={ROW_CLASS}>
      <PackThumbs thumbs={thumbsOf(pack)} size={THUMB_SIZE} />
      <PackRowText pack={pack} shared={false} meta={countLabel(pack)} />
      {added ? (
        <IconButton
          aria-label={`${pack.title} is in your panel. Remove`}
          onClick={() => runRemove()}
        >
          <Check className="size-4 text-online" aria-hidden="true" />
        </IconButton>
      ) : (
        <Button type="button" className="shrink-0" onClick={() => runAdd()}>
          <Plus className="size-4" aria-hidden="true" />
          Add
        </Button>
      )}
    </li>
  );
}
