import { useDelayed } from '@/lib/useDelayed';

/** Quiet loading placeholders in the shape of the content they replace. */

// Most loads finish in well under this. Showing placeholders only after it
// avoids a skeleton that flashes for a frame and then vanishes.
export const SKELETON_DELAY_MS = 300;

export function ChatListSkeleton({ rows = 6 }: { rows?: number }) {
  const visible = useDelayed(true, SKELETON_DELAY_MS) === true;
  return (
    <div role="status" aria-label="Loading chats" className="flex flex-col gap-0.5 px-2 py-1">
      {Array.from({ length: visible ? rows : 0 }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className="flex animate-pulse items-center gap-3 rounded-[12px] p-[10px]"
        >
          <div className="size-11 shrink-0 rounded-full bg-surface-raised" />
          <div className="min-w-0 flex-1">
            <div className="h-4 w-2/5 rounded-full bg-surface-raised" />
            <div className="mt-2 h-3.5 w-4/5 rounded-full bg-surface-raised" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function MessageListSkeleton() {
  const visible = useDelayed(true, SKELETON_DELAY_MS) === true;
  return (
    <div role="status" aria-label="Loading messages" className="chat-background h-full">
      {visible && (
        <div
          aria-hidden="true"
          className="mx-auto flex w-full max-w-[860px] animate-pulse flex-col gap-2 px-3 pt-3 pb-4"
        >
          <div className="h-12 w-2/3 rounded-[14px] bg-bubble-in" />
          <div className="h-10 w-1/2 self-end rounded-[14px] bg-bubble-out" />
          <div className="h-14 w-3/5 rounded-[14px] bg-bubble-in" />
          <div className="h-10 w-2/5 self-end rounded-[14px] bg-bubble-out" />
        </div>
      )}
    </div>
  );
}
