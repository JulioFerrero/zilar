import type { Ref } from 'react';

/** Full-width "Unread messages" bar shown above the first unread message. */
export function UnreadDivider({ ref }: { ref?: Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className="my-3 w-full">
      <div className="well-surface w-full rounded-[10px] px-3 py-1.5 text-center text-[12px] font-medium text-muted-foreground">
        Unread messages
      </div>
    </div>
  );
}
