import { File as FileIcon, Image as ImageIcon, Paperclip } from 'lucide-react';
import { useRef, useState, type RefObject } from 'react';
import { IconButton } from '../ui/icon-button';
import { Menu, MenuItem } from '../ui/menu';

/**
 * The composer's paperclip (T-1324): it opens a small menu, Telegram-style,
 * with "Photo or video" and "File". Each entry clicks one hidden input; the
 * menu itself is the shared `ui/menu`, which closes on Escape or an outside
 * click and returns focus to the paperclip.
 */
export function AttachMenu({
  onPickMedia,
  onPickFiles,
}: {
  /** Files chosen through "Photo or video" (`accept="image/*,video/*"`). */
  onPickMedia: (files: File[]) => void;
  /** Files chosen through "File" (any type). */
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
      <IconButton
        aria-label="Attach"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Paperclip className="size-5" aria-hidden="true" />
      </IconButton>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        label="Attach"
        closeLabel="Close attach menu"
        className="bottom-full left-0 mb-2"
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
