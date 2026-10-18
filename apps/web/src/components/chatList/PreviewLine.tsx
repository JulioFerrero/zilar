import type { LucideIcon } from 'lucide-react';

type PreviewLineProps = { KindIcon: LucideIcon | undefined; prefix: string; body: string };

/** The preview line shared by the chat list and the topic rows. */
export function PreviewLine({ KindIcon, prefix, body }: PreviewLineProps) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[13px] leading-5 text-muted-foreground">
      {KindIcon !== undefined && <KindIcon className="size-3.5 shrink-0" aria-hidden="true" />}
      <span className="truncate">
        {prefix.length > 0 && <span className="text-foreground">{prefix}</span>}
        {body}
      </span>
    </span>
  );
}
