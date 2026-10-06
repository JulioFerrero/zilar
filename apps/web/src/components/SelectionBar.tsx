import { useEffect } from 'react';
import { Button } from './ui/button';

/**
 * The bottom bar shown while several messages are selected for forwarding
 * (T-0439). It replaces the composer: "N selected", Cancel and Forward
 * (disabled while nothing is checked). Escape leaves select mode.
 */
export function SelectionBar({
  count,
  onForward,
  onCancel,
}: {
  count: number;
  onForward: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div className="chat-background relative shrink-0 px-3 pt-2 pb-3 wide:px-8 wide:pt-3 wide:pb-5">
      <div className="flex items-center gap-3 rounded-[14px] bg-surface-raised px-4 py-2.5">
        <p aria-live="polite" className="min-w-0 flex-1 truncate text-[14px] font-medium">
          {count} selected
        </p>
        <Button type="button" variant="outline" className="shrink-0" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" className="shrink-0" disabled={count === 0} onClick={onForward}>
          Forward
        </Button>
      </div>
    </div>
  );
}
