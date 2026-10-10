import { type Dispatch, type SetStateAction } from 'react';
import { FOLDER_ICONS, FOLDER_NAME_MAX, type FolderIcon } from '@zilar/chat-core';
import { folderIconComponent } from '@/components/folderIcon';
import { cn } from '@/lib/utils';
import { SECTION_LABEL } from './folderEditorModel';

export function FolderIconPicker({
  name,
  setName,
  icon,
  setIcon,
}: {
  name: string;
  setName: Dispatch<SetStateAction<string>>;
  icon: FolderIcon;
  setIcon: Dispatch<SetStateAction<FolderIcon>>;
}) {
  return (
    <section aria-label="Name and icon">
      <h3 className={SECTION_LABEL}>Name and icon</h3>
      <div className="mt-2 rounded-xl border border-border bg-surface">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <label htmlFor="folder-name" className="sr-only">
            Name
          </label>
          <input
            id="folder-name"
            type="text"
            value={name}
            maxLength={FOLDER_NAME_MAX}
            onChange={(event) => setName(event.target.value)}
            placeholder="Folder name"
            className="min-w-0 flex-1 bg-transparent text-[15px] focus-visible:outline-none"
          />
          <span
            data-testid="folder-name-counter"
            className="shrink-0 text-[13px] text-muted-foreground tabular-nums"
          >
            {Math.min(name.length, FOLDER_NAME_MAX)}/{FOLDER_NAME_MAX}
          </span>
        </div>
        <div className="border-t border-border px-3 py-2.5">
          <div role="radiogroup" aria-label="Icon" className="grid grid-cols-6 gap-1">
            {FOLDER_ICONS.map((iconName) => {
              const Icon = folderIconComponent(iconName);
              const selected = icon === iconName;
              return (
                <button
                  key={iconName}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={iconName}
                  title={iconName}
                  onClick={() => setIcon(iconName)}
                  className={cn(
                    'flex items-center justify-center rounded-xl p-2 transition-colors hover:text-foreground',
                    selected ? 'key-icon text-foreground' : 'text-muted-foreground',
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
