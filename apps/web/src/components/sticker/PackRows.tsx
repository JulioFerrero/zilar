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

const ROW_CLASS = 'flex items-center gap-3 border-b border-divider px-3 py-2.5 last:border-b-0';
const THUMB_SIZE = 36;

function countLabel(pack: StickerPack): string {
  const count = pack.stickers.length;
  return `${count} sticker${count === 1 ? '' : 's'}`;
}

function ownerCountLabel(pack: StickerPack): string {
  if (pack.ownerHandle === undefined || pack.ownerHandle === null) {
    return countLabel(pack);
  }
  return `${countLabel(pack)} · @${pack.ownerHandle}`;
}

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

export function AddedPackRow({ pack, setters }: { pack: StickerPack; setters: PageSetters }) {
  const [, runRemove] = useAction<void, void, never>(() => removeFromPanel(pack.id, setters));
  return (
    <li className={ROW_CLASS}>
      <PackThumbs thumbs={thumbsOf(pack)} size={THUMB_SIZE} />
      <PackRowText pack={pack} shared={false} meta={ownerCountLabel(pack)} />
      <IconButton aria-label={`Remove ${pack.title} from panel`} onClick={() => runRemove()}>
        <CircleMinus className="size-4" aria-hidden="true" />
      </IconButton>
    </li>
  );
}

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
      <PackRowText pack={pack} shared={false} meta={ownerCountLabel(pack)} />
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
