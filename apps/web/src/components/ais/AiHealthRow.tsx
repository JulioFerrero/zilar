import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { MessageSquare, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { aiHealth, formatUsd, spendFraction, type AiHealthInput } from '@zilar/chat-core';
import { ApiError, deleteAi, type PublicAi } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import type { ApiFailure } from '@/lib/effect/errors';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { cn } from '@/lib/utils';
import { AiBadge } from '@/components/AiBadge';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EntityAvatar } from '@/components/EntityAvatar';
import { FieldError } from '@/components/ais/AiPageShell';
import { describeAiError } from '@/components/ais/errors';
import { formatLimit } from '@/components/ais/limits';
import { IconButton } from '@/components/ui/icon-button';
import { Menu, MenuItem } from '@/components/ui/menu';

/** The last failure, hidden while a new call runs (the page cleared it at once before). */
function shownFailure<A, E>(state: AsyncResult.AsyncResult<A, E>): E | undefined {
  return isWaiting(state) ? undefined : failureOf(state);
}

/**
 * The words for an api.ts failure, through describeAiError so each server code
 * keeps its wording. A call that never reached the server gets the fallback.
 */
function aiFailureText(failure: ApiFailure, fallback: string): string {
  if (failure.code === 'unknown_error') {
    return fallback;
  }
  return describeAiError(
    new ApiError(failure.status, failure.code, failure.message, failure.detail),
    fallback,
  ).message;
}

// The fix link inside the muted line: a bright, underline-on-hover link.
const FIX_LINK = 'text-accent underline-offset-2 hover:underline';

/**
 * One AI row (T-1510): its picture with a health dot (the status), the name and
 * the "AI" badge, one muted line (model · provider, a failure reason with its
 * fix, or the daily-limit pause), today's spend with its limit bar, and a ⋮
 * menu (Open chat, Edit, Delete with a confirm dialog).
 */
export function AiHealthRow({
  ai,
  providerName,
  onOpenChat,
  onEdit,
  onDeleted,
}: {
  ai: PublicAi;
  providerName: string | undefined;
  onOpenChat: () => void;
  onEdit: () => void;
  onDeleted: (id: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleteState, remove, controls] = useAction((id: string) =>
    fromApi(() => deleteAi(id)).pipe(
      Effect.tap(() => Effect.sync(() => onDeleted(id))),
      Effect.ensuring(Effect.sync(() => setConfirming(false))),
    ),
  );
  const deleting = isWaiting(deleteState);
  const failure = shownFailure(deleteState);
  const actionError =
    failure === undefined ? '' : aiFailureText(failure, 'Could not delete the AI');

  const askDelete = (): void => {
    controls.reset();
    setConfirming(true);
  };
  const cancelDelete = (): void => {
    controls.reset();
    setConfirming(false);
  };

  const usage = ai.usage ?? null;
  const dailyLimit = ai.limits.perDayUsd;

  // The helper's input: an older payload may leave `usage`/`lastFailure`
  // absent, which normalises to `null` under exactOptionalPropertyTypes.
  const healthInput: AiHealthInput = {
    status: ai.status,
    limits: ai.limits,
    usage,
    lastFailure: ai.lastFailure ?? null,
  };

  // The health rules come from @zilar/chat-core (T-1538), shared with the phone.
  const health = aiHealth(healthInput);

  // The health dot: the state's label and colour; first match wins.
  const dot =
    health.state === 'stopped'
      ? { label: 'Stopped', colour: 'bg-subtle-foreground' }
      : health.state === 'failing'
        ? { label: 'Failing', colour: 'bg-danger' }
        : health.state === 'paused'
          ? { label: 'Paused by its limit', colour: 'bg-[#f59e0b]' }
          : { label: 'Working', colour: 'bg-online' };

  // One muted line: the model and provider, a failure reason with its fix, or
  // the daily-limit pause. Stopped and failing win over the pause.
  const mutedLine: ReactNode = (() => {
    if (health.state === 'stopped') {
      return `Stopped · ${ai.model}`;
    }
    if (health.state === 'failing') {
      const reason = health.reason ?? 'Last reply failed';
      if (health.fix === 'replace_key') {
        return (
          <>
            <span className="text-danger">{reason}</span>
            {' · '}
            <Link to="/settings/connections" className={FIX_LINK}>
              Replace key
            </Link>
          </>
        );
      }
      if (health.fix === 'change_model') {
        return (
          <>
            <span className="text-danger">{reason}</span>
            {' · '}
            <button type="button" className={FIX_LINK} onClick={onEdit}>
              Change model
            </button>
          </>
        );
      }
      return (
        <>
          <span className="text-danger">{reason}</span>
          {` · ${ai.model}`}
        </>
      );
    }
    if (health.state === 'paused') {
      return (
        <>
          <span className="text-[#f59e0b]">Daily limit reached</span>
          {` · ${ai.model}`}
        </>
      );
    }
    return providerName === undefined ? ai.model : `${ai.model} · ${providerName}`;
  })();

  const usedFraction = spendFraction(healthInput) ?? 0;
  const full = usedFraction === 1;

  return (
    <li className="flex items-center gap-3.5 border-b border-divider py-3 pr-2.5 pl-3.5 last:border-b-0">
      <span className="relative shrink-0">
        <EntityAvatar
          person={{ id: ai.jid, name: ai.name, avatarUrl: ai.avatarUrl }}
          size={40}
          ai
        />
        <span
          role="img"
          aria-label={dot.label}
          className={cn(
            'absolute -right-px -bottom-px size-3 rounded-full ring-2 ring-surface',
            dot.colour,
          )}
        />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-[14px] font-semibold">{ai.name}</span>
          <AiBadge />
        </span>
        <p className="text-[13px] text-muted-foreground">{mutedLine}</p>
        {actionError !== '' && <FieldError>{actionError}</FieldError>}
      </div>
      <div className="flex w-24 shrink-0 flex-col items-end gap-[5px]">
        {usage === null ? (
          <span className="font-mono text-[12px] text-muted-foreground">—</span>
        ) : dailyLimit === null ? (
          <span className="font-mono text-[12px] text-foreground">{formatUsd(usage.todayUsd)}</span>
        ) : (
          <>
            <span className="font-mono text-[12px] text-foreground">
              {formatUsd(usage.todayUsd)}{' '}
              <span className="text-subtle-foreground">/ {formatLimit(dailyLimit)}</span>
            </span>
            <span className="h-1 w-[72px] overflow-hidden rounded-[2px] bg-well">
              <span
                className={cn('block h-full', full ? 'bg-[#f59e0b]' : 'bg-foreground')}
                style={{ width: `${usedFraction * 100}%` }}
              />
            </span>
          </>
        )}
      </div>
      <Menu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        label={`${ai.name} actions`}
        align="end"
        trigger={
          <IconButton aria-label={`${ai.name} actions`}>
            <MoreVertical className="size-4" aria-hidden="true" />
          </IconButton>
        }
      >
        <MenuItem
          icon={MessageSquare}
          onSelect={() => {
            setMenuOpen(false);
            onOpenChat();
          }}
        >
          Open chat
        </MenuItem>
        <MenuItem
          icon={Pencil}
          onSelect={() => {
            setMenuOpen(false);
            onEdit();
          }}
        >
          Edit
        </MenuItem>
        <MenuItem
          icon={Trash2}
          destructive
          onSelect={() => {
            setMenuOpen(false);
            askDelete();
          }}
        >
          Delete
        </MenuItem>
      </Menu>
      {confirming && (
        <ConfirmDialog
          title={`Delete ${ai.name}?`}
          body="This removes the AI and its chat. Your provider connection stays."
          confirmLabel={deleting ? 'Deleting…' : 'Delete'}
          onConfirm={() => remove(ai.id)}
          onCancel={cancelDelete}
        />
      )}
    </li>
  );
}
