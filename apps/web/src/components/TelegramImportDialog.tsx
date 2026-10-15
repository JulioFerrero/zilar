import { useState } from 'react';
import { Link } from 'react-router';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { importTelegramStickers } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useIsServerOwner } from '@/lib/useIsServerOwner';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import { Dialog } from './ui/dialog';

/**
 * The Telegram import dialog (T-0123, overlay + unavailable state T-0162):
 * paste a pack link or name, run the import, and read the summary.
 * Imported packs are personal-use only — the dialog says so next to the
 * form, and the summary repeats the attribution
 * ("Imported from Telegram: <pack title>").
 *
 * It renders through the kit `Dialog`: Escape and the backdrop close it
 * (not while busy), focus moves to the input on open, and a 501 never
 * closes it — it shows the not-set-up state instead (with a settings link
 * for the server owner).
 */
export function TelegramImportDialog({
  onDone,
  onClose,
  onUnavailable,
  isOwner,
  importFn = importTelegramStickers,
}: {
  onDone: () => void;
  onClose: () => void;
  /**
   * Called when the server answers 501, so the entry point's primary action
   * can be disabled. The entry stays visible and the dialog shows why.
   */
  onUnavailable?: () => void;
  /**
   * Forces the owner view (tests only). When omitted the dialog reads the
   * shared `useIsServerOwner` hook, which starts as not-owner and switches
   * on after the 200 — the settings link never flashes for a non-owner.
   */
  isOwner?: boolean | undefined;
  /** Injected in tests so no network is touched. */
  importFn?: typeof importTelegramStickers;
}) {
  const [input, setInput] = useState('');
  const [notice, setNotice] = useState('');
  // The import call. Unmounting interrupts it, so a closed dialog never
  // reports back. A 501 also tells the entry point (`onUnavailable`).
  const [importState, runImport] = useAction((value: string) =>
    fromApi(() => importFn(value)).pipe(
      Effect.tapError((failure) =>
        Effect.sync(() => {
          if (failure.status === 501) {
            onUnavailable?.();
          }
        }),
      ),
    ),
  );
  const busy = isWaiting(importState);
  // A call that is running hides the previous outcome, as the form did before.
  const failure = busy ? undefined : failureOf(importState);
  const result = !busy && AsyncResult.isSuccess(importState) ? importState.value : undefined;
  // The not-set-up state and the token state replace the form. The saved
  // token died at Telegram's side (revoked or replaced after it was stored):
  // not a form error, so the whole dialog becomes the message.
  const unavailable = failure?.status === 501;
  const tokenInvalid = failure?.code === 'token_invalid';
  // The owner view: the prop wins when given (tests), else the shared hook.
  // The hook call is unconditional (rules of hooks); the prop only decides
  // which value is used.
  const hookOwner = useIsServerOwner();
  const ownerView = isOwner ?? hookOwner;
  const error = notice !== '' ? notice : failure !== undefined ? importErrorText(failure) : '';

  const run = (): void => {
    if (input.trim() === '') {
      setNotice('Paste a pack link or name first.');
      return;
    }
    setNotice('');
    runImport(input);
  };

  if (unavailable) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="Telegram import is not set up"
        ariaLabel="Telegram import not set up"
        size="sm"
      >
        <p className="mt-2 text-[14px] text-muted-foreground">
          Telegram import is not set up on this server.
        </p>
        {ownerView ? (
          <p className="mt-3 text-[14px]">
            <Link to="/settings/integrations" className="text-accent underline hover:no-underline">
              Open the integrations settings to add a bot token.
            </Link>
          </p>
        ) : (
          <p className="mt-3 text-[14px] text-muted-foreground">
            Ask the person who runs this server to set it up.
          </p>
        )}
      </Dialog>
    );
  }

  if (tokenInvalid) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="The Telegram token was rejected"
        ariaLabel="Telegram token rejected"
        size="sm"
      >
        {ownerView ? (
          <p className="mt-2 text-[14px]">
            The Telegram token was rejected. The server owner needs to update it —{' '}
            <Link to="/settings/integrations" className="text-accent underline hover:no-underline">
              open the integrations settings.
            </Link>
          </p>
        ) : (
          <p className="mt-2 text-[14px] text-muted-foreground">
            The Telegram token was rejected. The server owner needs to update it.
          </p>
        )}
      </Dialog>
    );
  }

  if (result !== undefined) {
    return (
      <Dialog
        open
        onClose={() => {
          onDone();
          onClose();
        }}
        title={`Imported from Telegram: ${result.pack.title}`}
        ariaLabel="Telegram import result"
        size="sm"
      >
        <p className="mt-2 text-[14px]">
          {result.imported} sticker{result.imported === 1 ? '' : 's'} added
          {result.skippedAnimated > 0 &&
            `, ${result.skippedAnimated} animated sticker${result.skippedAnimated === 1 ? ' was' : 's were'} skipped`}
          {result.skippedInvalid > 0 &&
            `, ${result.skippedInvalid} file${result.skippedInvalid === 1 ? ' was' : 's were'} skipped as invalid`}
          .
        </p>
        {result.partial === true && (
          <p className="mt-1 text-[14px] text-muted-foreground">
            The import ran out of time — run it again to fill in the rest.
          </p>
        )}
        <p className="mt-1 text-[13px] text-muted-foreground">
          Imported packs are for personal use: this pack stays private and its art belongs to its
          creators.
        </p>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Import from Telegram"
      size="sm"
      busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        run();
      }}
      {...(error === '' ? {} : { error })}
      actions={
        <Button type="submit" disabled={busy} size="lg">
          {busy ? 'Importing…' : 'Import'}
        </Button>
      }
    >
      <p className="mt-2 text-[13px] text-muted-foreground">
        Paste a pack link (<code>t.me/addstickers/…</code>) or the bare pack name. Only static
        stickers import — animated and video ones are skipped. Imported packs are for personal use:
        they stay private and cannot be shared server-wide.
      </p>
      <div className="mt-3">
        <TextInput
          label="Pack link or name"
          data-autofocus
          value={input}
          placeholder="t.me/addstickers/FunCats"
          maxLength={512}
          disabled={busy}
          onChange={(event) => setInput(event.target.value)}
        />
      </div>
    </Dialog>
  );
}

/** The fixed sentence for each server answer; anything else shows the server's own message. */
function importErrorText(failure: ApiFailure): string {
  if (failure.status === 429) {
    return 'Too many imports — try again in an hour.';
  }
  if (failure.code === 'pack_not_found') {
    return 'That Telegram sticker pack was not found.';
  }
  if (failure.code === 'custom_emoji_unsupported') {
    return 'Custom emoji sets cannot be imported as sticker packs.';
  }
  if (failure.code === 'try_later') {
    return 'Telegram is busy — try again later.';
  }
  return failure.code === 'unknown_error' ? 'The import failed.' : failure.message;
}
