import { type ComponentProps, type Dispatch, type SetStateAction } from 'react';
import { Switch } from '@/components/ui/switch';
import { ChatPicker } from './ChatPicker';
import { SECTION_LABEL } from './folderEditorModel';

export function FolderHideSection({
  excludeMuted,
  setExcludeMuted,
  excludeRead,
  setExcludeRead,
  excludeChats,
  setExcludeChats,
  excludeSearch,
  setExcludeSearch,
  toggle,
  chats,
}: {
  excludeMuted: boolean;
  setExcludeMuted: Dispatch<SetStateAction<boolean>>;
  excludeRead: boolean;
  setExcludeRead: Dispatch<SetStateAction<boolean>>;
  excludeChats: string[];
  setExcludeChats: Dispatch<SetStateAction<string[]>>;
  excludeSearch: string;
  setExcludeSearch: Dispatch<SetStateAction<string>>;
  toggle: (list: string[], id: string) => string[];
  chats: ComponentProps<typeof ChatPicker>['chats'];
}) {
  return (
    <section aria-label="Hide" className="mt-5">
      <h3 className={SECTION_LABEL}>Hide</h3>
      <div className="mt-2 divide-y divide-border rounded-xl border border-border bg-surface">
        <div className="flex items-center gap-2 px-3 py-2 text-[15px]">
          <span className="min-w-0 flex-1">Muted chats</span>
          <Switch
            checked={excludeMuted}
            label="Muted chats"
            hideLabel
            onCheckedChange={() => setExcludeMuted((value) => !value)}
          />
        </div>
        <div className="flex items-center gap-2 px-3 py-2 text-[15px]">
          <span className="min-w-0 flex-1">Read chats</span>
          <Switch
            checked={excludeRead}
            label="Read chats"
            hideLabel
            onCheckedChange={() => setExcludeRead((value) => !value)}
          />
        </div>
      </div>
      <div className="mt-2 rounded-xl border border-border bg-surface px-3 py-2.5">
        <ChatPicker
          id="exclude"
          label="Exclude chats"
          picked={excludeChats}
          chats={chats}
          search={excludeSearch}
          onSearch={setExcludeSearch}
          onToggle={(id) => setExcludeChats((list) => toggle(list, id))}
        />
      </div>
    </section>
  );
}
