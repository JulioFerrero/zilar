import type { Ref } from 'react';

/** Full-width "Unread messages" bar shown above the first unread message. */
export function UnreadDivider({ ref }: { ref?: Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className="my-2 w-full">
      <div className="rounded-md bg-black/10 px-3 py-1 text-center text-[12px] font-medium text-muted-foreground backdrop-blur-sm dark:bg-white/10">
        Unread messages
      </div>
    </div>
  );
}
