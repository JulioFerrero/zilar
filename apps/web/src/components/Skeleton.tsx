/** Quiet loading placeholders in the shape of the content they replace. */

export function ChatListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading chats" className="flex flex-col px-2.5 py-1">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className="flex h-[72px] animate-pulse items-center gap-3"
        >
          <div className="size-[54px] shrink-0 rounded-full bg-muted" />
          <div className="min-w-0 flex-1">
            <div className="h-4 w-2/5 rounded-full bg-muted" />
            <div className="mt-2 h-3.5 w-4/5 rounded-full bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function MessageListSkeleton() {
  return (
    <div role="status" aria-label="Loading messages" className="chat-background h-full">
      <div
        aria-hidden="true"
        className="mx-auto flex w-full max-w-[860px] animate-pulse flex-col gap-2 px-3 pt-3 pb-4"
      >
        <div className="h-12 w-2/3 rounded-2xl bg-bubble-in" />
        <div className="h-10 w-1/2 self-end rounded-2xl bg-bubble-out" />
        <div className="h-14 w-3/5 rounded-2xl bg-bubble-in" />
        <div className="h-10 w-2/5 self-end rounded-2xl bg-bubble-out" />
      </div>
    </div>
  );
}
