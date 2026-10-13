import { formatDateSeparator } from '@zilar/chat-core';

/**
 * The inline date divider: a plain flow row, so it scrolls away with its
 * messages instead of pinning. T-1327: a sticky row pinned every separator to
 * the top at once (all of them share the list as their containing block), so
 * they stacked into each other and the newest one covered messages at rest.
 */
export function DateSeparator({ date }: { date: Date }) {
  return (
    <div className="flex justify-center py-2">
      <span className="raised-pill rounded-full px-2.5 py-1 text-[12px] font-medium text-muted-foreground">
        {formatDateSeparator(date, new Date())}
      </span>
    </div>
  );
}
