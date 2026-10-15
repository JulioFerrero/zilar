import { useState } from 'react';
import { Effect } from 'effect';
import { CircleMinus, Lock, MoreVertical, Pencil, Share, Trash2, Unlock } from 'lucide-react';
import type { StickerPack } from '@/lib/api';
import { copyText } from '@/lib/clipboard';
import { useAction } from '@/lib/effect/use-action';
import { IconButton } from '@/components/ui/icon-button';
import { Menu, MenuItem } from '@/components/ui/menu';
import { useToast } from '@/components/ui/toast';
import { type PageSetters, removeFromPanel, stickerPackUrl, toggleVisibility } from './pageActions';

/**
 * The ⋮ menu on a pack I own (Main.dc.html, T-1497): Share, Edit, the
 * visibility switch, Remove from panel and Delete. An imported pack keeps
 * no visibility item, the way its inline key was locked before.
 */
export function PackMenu({
  pack,
  setters,
  onEdit,
  onDelete,
}: {
  pack: StickerPack;
  setters: PageSetters;
  onEdit: (packId: string) => void;
  onDelete: (pack: StickerPack) => void;
}) {
  const [open, setOpen] = useState(false);
  const show = useToast();
  const [, runVisibility] = useAction<void, void, never>(() => toggleVisibility(pack, setters));
  const [, runRemove] = useAction<void, void, never>(() => removeFromPanel(pack.id, setters));
  const [, copy] = useAction<string, void, unknown>((url) =>
    Effect.tryPromise({ try: () => copyText(url), catch: (cause) => cause }).pipe(
      Effect.tap(() => Effect.sync(() => show('Link copied'))),
    ),
  );
  const imported = pack.importedFrom !== undefined;
  const shared = pack.visibility === 'server';

  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      label={`${pack.title} actions`}
      align="end"
      trigger={
        <IconButton aria-label={`${pack.title} actions`}>
          <MoreVertical className="size-4" aria-hidden="true" />
        </IconButton>
      }
    >
      <MenuItem icon={Share} onSelect={() => copy(stickerPackUrl(pack.id))}>
        Share
      </MenuItem>
      <MenuItem
        icon={Pencil}
        onSelect={() => {
          setOpen(false);
          onEdit(pack.id);
        }}
      >
        Edit
      </MenuItem>
      {!imported && (
        <MenuItem icon={shared ? Lock : Unlock} onSelect={() => runVisibility()}>
          {shared ? 'Make private' : 'Make shared'}
        </MenuItem>
      )}
      <MenuItem icon={CircleMinus} onSelect={() => runRemove()}>
        Remove from panel
      </MenuItem>
      <MenuItem
        icon={Trash2}
        destructive
        onSelect={() => {
          setOpen(false);
          onDelete(pack);
        }}
      >
        Delete
      </MenuItem>
    </Menu>
  );
}
