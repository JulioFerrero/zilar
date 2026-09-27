import { formatDateSeparator } from '@galena/chat-core';

export function DateSeparator({ date }: { date: Date }) {
  return (
    <div className="flex justify-center py-1.5">
      <span className="rounded-full bg-black/25 px-3 py-1 text-[12px] font-medium text-white backdrop-blur-sm">
        {formatDateSeparator(date, new Date())}
      </span>
    </div>
  );
}
