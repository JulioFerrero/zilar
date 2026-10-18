import { File as FileIcon, Image as ImageIcon, Paperclip } from 'lucide-react';
import { useRef, useState, type RefObject } from 'react';
import { IconButton } from '../ui/icon-button';
import { Menu, MenuItem } from '../ui/menu';

export function AttachMenu({
  onPickMedia,
  onPickFiles,
}: {
  onPickMedia: (files: File[]) => void;
  onPickFiles: (files: File[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const choose = (ref: RefObject<HTMLInputElement | null>): void => {
    setOpen(false);
    ref.current?.click();
  };

  return (
    <div className="relative inline-flex shrink-0">
      <input
        ref={mediaInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(event) => {
          const chosen = event.target.files;
          if (chosen !== null && chosen.length > 0) {
            onPickMedia([...chosen]);
          }
          event.target.value = '';
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          const chosen = event.target.files;
          if (chosen !== null && chosen.length > 0) {
            onPickFiles([...chosen]);
          }
          event.target.value = '';
        }}
      />
      <Menu
        open={open}
        onOpenChange={setOpen}
        label="Attach"
        side="top"
        align="start"
        sideOffset={8}
        trigger={
          <IconButton aria-label="Attach">
            <Paperclip className="size-5" aria-hidden="true" />
          </IconButton>
        }
      >
        <MenuItem icon={ImageIcon} onSelect={() => choose(mediaInputRef)}>
          Photo or video
        </MenuItem>
        <MenuItem icon={FileIcon} onSelect={() => choose(fileInputRef)}>
          File
        </MenuItem>
      </Menu>
    </div>
  );
}
