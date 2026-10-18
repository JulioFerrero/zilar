import { Effect } from 'effect';
import { Copy, Link } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { useToast } from '@/components/ui/toast';
import { Well } from '@/components/ui/well';
import { copyText } from '@/lib/clipboard';
import { useAction } from '@/lib/effect/use-action';
import { stickerPackUrl, stickerPackUrlText } from './pageActions';

export function PackLinkRow({ packId }: { packId: string }) {
  const show = useToast();
  const [, copy] = useAction<string, void, unknown>((url) =>
    Effect.tryPromise({ try: () => copyText(url), catch: (cause) => cause }).pipe(
      Effect.tap(() => Effect.sync(() => show('Link copied'))),
    ),
  );
  return (
    <Well className="flex h-10 items-center gap-2 pr-1 pl-3">
      <Link className="size-[15px] shrink-0 text-subtle-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-foreground">
        {stickerPackUrlText(packId)}
      </span>
      <IconButton
        size={32}
        radius={8}
        aria-label="Copy link"
        onClick={() => copy(stickerPackUrl(packId))}
      >
        <Copy className="size-3.5" aria-hidden="true" />
      </IconButton>
    </Well>
  );
}
