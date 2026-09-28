import { formatDateSeparator } from '@galena/chat-core';

export function DateSeparator({ date }: { date: Date }) {
  return (
    <div className="flex justify-center py-2">
      <span className="raised-pill rounded-full px-2.5 py-1 text-[12px] font-medium text-muted-foreground">
        {formatDateSeparator(date, new Date())}
      </span>
    </div>
  );
}
