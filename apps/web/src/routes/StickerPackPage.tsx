import { useState } from 'react';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useNavigate, useParams } from 'react-router';
import { Check, ChevronLeft, Globe, Plus, Share } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { StateMessage } from '@/components/ui/state-message';
import { useToast } from '@/components/ui/toast';
import { copyText } from '@/lib/clipboard';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import type { Sticker } from '@/lib/api';
import type { StickerChoice } from '@/components/StickerPanel';
import { PackLinkRow } from '@/components/sticker/PackLinkRow';
import { StickerThumb } from '@/components/sticker/StickerThumb';
import {
  addPackToPanel,
  failureText,
  loadPackDetail,
  removePackFromPanel,
  stickerPackUrl,
} from '@/components/sticker/pageActions';

/** One contract sticker as the panel thumbnail takes it. */
function toChoice(sticker: Sticker): StickerChoice {
  return {
    stickerId: sticker.id,
    packId: sticker.packId,
    url: sticker.url,
    ...(sticker.emoji === null ? {} : { emoji: sticker.emoji }),
    width: sticker.width,
    height: sticker.height,
    mime: sticker.mime,
  };
}

/**
 * The page a pack link opens (T-1497): `/stickers/<packId>`. It follows
 * `WebPack.dc.html`: a Back key, the title, Share and Add, then the count and
 * owner, the copyable link and the sticker grid. Anyone signed in who has the
 * link may open and add the pack; an unknown or someone else's imported pack
 * answers the same "not available".
 */
export function StickerPackPage() {
  const params = useParams<{ packId?: string }>();
  const packId = params.packId ?? '';
  const navigate = useNavigate();
  const auth = useAuth();
  const show = useToast();

  const [packState, reloadPack] = useQuery(() => loadPackDetail(packId), [packId]);
  // The in-panel state the Add/Remove keys switch locally, before the refetch.
  // It records the pack it applies to, so a link to another pack ignores it.
  const [panelOverride, setPanelOverride] = useState<
    { packId: string; inPanel: boolean } | undefined
  >(undefined);
  const [actionError, setActionError] = useState('');

  const [, runAdd] = useAction<void, void, never>(() =>
    Effect.sync(() => setActionError('')).pipe(
      Effect.andThen(addPackToPanel(packId)),
      Effect.tap(() => Effect.sync(() => setPanelOverride({ packId, inPanel: true }))),
      Effect.catchTag('ApiFailure', (failure) =>
        Effect.sync(() => setActionError(failureText(failure, 'Could not add the pack'))),
      ),
    ),
  );
  const [, runRemove] = useAction<void, void, never>(() =>
    Effect.sync(() => setActionError('')).pipe(
      Effect.andThen(removePackFromPanel(packId)),
      Effect.tap(() => Effect.sync(() => setPanelOverride({ packId, inPanel: false }))),
      Effect.catchTag('ApiFailure', (failure) =>
        Effect.sync(() => setActionError(failureText(failure, 'Could not remove the pack'))),
      ),
    ),
  );
  const [, share] = useAction<string, void, unknown>((url) =>
    Effect.tryPromise({ try: () => copyText(url), catch: (cause) => cause }).pipe(
      Effect.tap(() => Effect.sync(() => show('Link copied'))),
    ),
  );

  const pack = AsyncResult.isSuccess(packState) ? packState.value : undefined;
  const failure = isWaiting(packState) ? undefined : failureOf(packState);
  const loading = pack === undefined && failure === undefined;
  const isOwn =
    pack !== undefined && auth.status === 'authenticated' && auth.user?.id === pack.ownerId;
  const inPanel =
    panelOverride?.packId === packId ? panelOverride.inPanel : (pack?.inPanel ?? false);

  // Back goes to where the page came from; a fresh link (no history) falls
  // back to the sticker settings.
  const goBack = (): void => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/settings/stickers');
    }
  };

  const count = pack?.stickers.length ?? 0;
  const meta =
    pack === undefined
      ? ''
      : `${count} sticker${count === 1 ? '' : 's'}${
          pack.ownerHandle === null ? '' : ` · @${pack.ownerHandle}`
        }`;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="sticker-pack-page">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-divider px-4">
        <IconButton aria-label="Back" onClick={goBack}>
          <ChevronLeft className="size-4" aria-hidden="true" />
        </IconButton>
        <h1 className="min-w-0 flex-1 truncate text-[17px] font-semibold tracking-[-0.02em]">
          {pack?.title ?? ''}
        </h1>
        {pack !== undefined && (
          <IconButton
            aria-label={`Share ${pack.title}`}
            onClick={() => share(stickerPackUrl(packId))}
          >
            <Share className="size-4" aria-hidden="true" />
          </IconButton>
        )}
        {pack !== undefined && !isOwn && inPanel && (
          <IconButton
            aria-label={`${pack.title} is in your panel. Remove`}
            onClick={() => runRemove()}
          >
            <Check className="size-4 text-online" aria-hidden="true" />
          </IconButton>
        )}
        {pack !== undefined && !isOwn && !inPanel && (
          <Button type="button" onClick={() => runAdd()}>
            <Plus className="size-4" aria-hidden="true" />
            Add
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4 px-4 pt-6">
          {actionError !== '' && (
            <p role="alert" className="text-[14px] text-danger">
              {actionError}
            </p>
          )}

          {loading && <StateMessage kind="loading" title="Loading…" />}

          {failure !== undefined && failure.status === 404 && (
            <StateMessage
              kind="error"
              title="This pack is not available"
              action={{ label: 'Back', onClick: goBack }}
            />
          )}

          {failure !== undefined && failure.status !== 404 && (
            <StateMessage
              kind="error"
              title={failureText(failure, 'Could not load the pack')}
              action={{ label: 'Retry', onClick: () => reloadPack() }}
            />
          )}

          {pack !== undefined && (
            <>
              <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <span>{meta}</span>
                {pack.visibility === 'server' && (
                  <Globe className="size-[13px]" role="img" aria-label="Shared" />
                )}
              </div>

              <PackLinkRow packId={pack.id} />

              <div
                role="list"
                aria-label={`Stickers in ${pack.title}`}
                className="grid grid-cols-7 gap-2"
              >
                {pack.stickers.map((sticker) => (
                  <span
                    key={sticker.id}
                    role="listitem"
                    className="flex aspect-square items-center justify-center overflow-hidden rounded-2xl [&_img]:h-full [&_img]:w-full [&_img]:object-contain"
                  >
                    <StickerThumb sticker={toChoice(sticker)} size={200} />
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
