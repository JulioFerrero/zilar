import { Activity, Image as ImageIcon, Pin, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { ListRow } from '../ui/list-row';

export function ContentNav({
  chatId,
  pinCount,
  isManager,
  onOpenMedia,
  onOpenPage,
  extraRow,
}: {
  chatId: string;
  pinCount: number;
  isManager: boolean;
  onOpenMedia: () => void;
  onOpenPage: (page: 'activity' | 'allowed') => void;
  extraRow?: ReactNode;
}) {
  const storeApi = useChatStoreApi();
  return (
    <nav
      aria-label="Content"
      className="divide-y divide-divider overflow-hidden rounded-xl border border-border bg-surface"
    >
      <ListRow
        icon={<ImageIcon className="size-4" aria-hidden="true" />}
        title="Shared media"
        chevron
        onClick={onOpenMedia}
      />
      <ListRow
        icon={<Pin className="size-4" aria-hidden="true" />}
        title="Pinned messages"
        trailing={<span className="font-mono text-[12px]">{pinCount}</span>}
        chevron
        onClick={() => storeApi.getState().setPinsPanel(chatId)}
      />
      {extraRow}
      {isManager && (
        <>
          <ListRow
            icon={<Activity className="size-4" aria-hidden="true" />}
            title="Activity"
            chevron
            onClick={() => onOpenPage('activity')}
          />
          <ListRow
            icon={<ShieldCheck className="size-4" aria-hidden="true" />}
            title="Always allowed"
            chevron
            onClick={() => onOpenPage('allowed')}
          />
        </>
      )}
    </nav>
  );
}
