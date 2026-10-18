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

/** Telegram import dialog; imported packs are personal-use only. */
export function TelegramImportDialog({
  onDone,
  onClose,
  onUnavailable,
  isOwner,
  importFn = importTelegramStickers,
}: {
  onDone: () => void;
  onClose: () => void;
  onUnavailable?: () => void;
  isOwner?: boolean | undefined;
  importFn?: typeof importTelegramStickers;
}) {
  const [input, setInput] = useState('');
  const [notice, setNotice] = useState('');
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
  const failure = busy ? undefined : failureOf(importState);
  const result = !busy && AsyncResult.isSuccess(importState) ? importState.value : undefined;
  // A saved token can be revoked at Telegram's side; that is not a form error.
  const unavailable = failure?.status === 501;
  const tokenInvalid = failure?.code === 'token_invalid';
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
