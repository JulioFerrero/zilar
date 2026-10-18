import type { Contact, TaskSteps } from '@zilar/api-contract';
import { type AvatarPersonInput, type ChatSummary, formatClock } from '@zilar/chat-core';
import { defaultOpenStepId, stepsView, type DisplayStep, fromApi } from '@zilar/client-core';
import type { ProgressStep } from '@zilar/protocol';
import { AsyncResult } from 'effect/reactivity';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  LoaderCircle,
  ShieldCheck,
  Square,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { failureOf } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { cn } from '@/lib/utils';
import { useChatSelector } from '@/store/ChatStoreProvider';
import { EntityAvatar } from './EntityAvatar';
import { IconButton } from './ui/icon-button';
import { Sheet } from './ui/sheet';
import { StateMessage } from './ui/state-message';
import { Well } from './ui/well';
import { callApi } from '@/lib/effect/api-client';

// Owner only: an unknown task and one the caller may not see answer the same 404, which
// rejects with ApiError.

function getTaskSteps(taskId: string): Promise<TaskSteps> {
  return callApi((client) => client.agentTasks.steps({ params: { taskId } }));
}

function aiPersonOf(
  jid: string,
  fallbackName: string,
  contacts: readonly Contact[],
  chats: readonly ChatSummary[],
): AvatarPersonInput {
  const contact = contacts.find((entry) => entry.jid === jid);
  if (contact !== undefined) {
    return { id: jid, name: contact.name, avatarUrl: contact.avatarUrl };
  }
  const chat = chats.find((entry) => entry.id === jid);
  if (chat !== undefined) {
    return { id: jid, name: chat.title, avatarUrl: chat.avatarUrl };
  }
  return { id: jid, name: fallbackName };
}

export function StepStateIcon({
  state,
  reduceMotion,
  className = 'size-4',
}: {
  state: DisplayStep['state'] | ProgressStep['state'];
  reduceMotion: boolean;
  className?: string;
}) {
  const classes = cn(className, 'shrink-0');
  if (state === 'done') {
    return <Check className={cn(classes, 'text-accent')} aria-hidden="true" />;
  }
  if (state === 'failed') {
    return <X className={cn(classes, 'text-danger')} aria-hidden="true" />;
  }
  if (state === 'doing') {
    return (
      <LoaderCircle
        className={cn(
          classes,
          'text-accent',
          !reduceMotion && 'animate-spin',
          reduceMotion && 'spinner-reduced',
        )}
        aria-hidden="true"
      />
    );
  }
  if (state === 'stopped') {
    return <Square className={cn(classes, 'text-muted-foreground')} aria-hidden="true" />;
  }
  return <Circle className={cn(classes, 'text-muted-foreground')} aria-hidden="true" />;
}

function StepRow({
  step,
  open,
  reduceMotion,
  onToggle,
}: {
  step: DisplayStep;
  open: boolean;
  reduceMotion: boolean;
  onToggle: () => void;
}) {
  const expandable = step.actions.length > 0;
  const Chevron = open ? ChevronDown : ChevronRight;
  const content = (
    <>
      <StepStateIcon state={step.state} reduceMotion={reduceMotion} />
      <span className="min-w-0 flex-1 truncate">{step.label}</span>
      {step.approved && (
        <ShieldCheck className="size-3.5 shrink-0 text-muted-foreground" aria-label="Approved" />
      )}
      {step.durationMs !== null && (
        <span className="shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground">
          {formatClock(step.durationMs)}
        </span>
      )}
      {expandable && (
        <Chevron className="size-3.5 shrink-0 text-subtle-foreground" aria-hidden="true" />
      )}
    </>
  );
  return (
    <div className={cn('rounded-[10px]', open && 'bg-surface-raised')}>
      {expandable ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-h-11 w-full items-center gap-2.5 rounded-[10px] px-3 text-left text-[14px] font-medium hover:bg-list-hover"
        >
          {content}
        </button>
      ) : (
        <div className="flex min-h-11 w-full items-center gap-2.5 px-3 text-left text-[14px] font-medium">
          {content}
        </div>
      )}

      {open &&
        step.actions.map((action, index) => (
          <div key={`${step.id}:${index}`}>
            <div className="flex min-h-8 items-center gap-2.5 pr-3 pl-[42px] text-[13px]">
              {action.ok ? (
                <Check className="size-3.5 shrink-0 text-accent" aria-hidden="true" />
              ) : (
                <X className="size-3.5 shrink-0 text-danger" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-foreground">
                {action.command}
              </span>
              <span className="shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground">
                {formatClock(action.durationMs)}
              </span>
            </div>
            {!action.ok && action.error !== undefined && (
              <Well className="mr-3 mb-1.5 ml-[42px] max-h-40 overflow-auto p-2 font-mono text-[12px] leading-[17px] whitespace-pre-wrap text-muted-foreground">
                {action.error}
              </Well>
            )}
          </div>
        ))}
    </div>
  );
}

/**
 * Lists the card's steps, never model calls, tokens, money or the answer; a
 * missing log (kept 30 days) falls back to the card's steps.
 */
export function StepsPanel({
  chatId,
  taskId,
  onClose,
}: {
  chatId: string;
  taskId: string;
  onClose: () => void;
}) {
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const cardMessage = useChatSelector((state) =>
    state.messagesByChat[chatId]?.find(
      (entry) => entry.card?.type === 'progress' && entry.card.data.task_id === taskId,
    ),
  );
  const card = cardMessage?.card?.type === 'progress' ? cardMessage.card.data : undefined;
  const contacts = useChatSelector((state) => state.contacts);
  const chats = useChatSelector((state) => state.chats);
  const aiJid = card?.ai;
  const aiPerson =
    aiJid === undefined
      ? undefined
      : aiPersonOf(aiJid, cardMessage?.senderName ?? aiJid, contacts, chats);

  const [result, refresh] = useQuery(() => fromApi(() => getTaskSteps(taskId)), [taskId]);
  const failure = AsyncResult.isFailure(result) ? failureOf(result) : undefined;
  const loaded = AsyncResult.isSuccess(result) ? result.value.steps : undefined;
  const { steps, loading, errored } = stepsView(loaded, failure?.status, card);

  const defaultOpen = defaultOpenStepId(steps);
  const [chosenOpen, setChosenOpen] = useState<string | null>();
  const openId = chosenOpen === undefined ? defaultOpen : chosenOpen;
  const toggle = (id: string): void => setChosenOpen(openId === id ? null : id);

  return (
    <Sheet open onClose={onClose} ariaLabel="Steps">
      <header className="flex shrink-0 items-center gap-3 border-b border-divider p-4">
        {aiPerson !== undefined && <EntityAvatar person={aiPerson} size={28} ai />}
        <h2 className="min-w-0 flex-1 truncate text-[16px] font-semibold">
          {card?.title ?? 'Steps'}
        </h2>
        {card?.elapsed_ms !== undefined && (
          <span className="shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground">
            {formatClock(card.elapsed_ms)}
          </span>
        )}
        <IconButton aria-label="Close steps" onClick={onClose}>
          <X className="size-4" aria-hidden="true" />
        </IconButton>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {loading && <StateMessage kind="loading" size="inline" title="Loading…" />}
        {errored && (
          <StateMessage
            kind="error"
            title="Could not load the steps."
            action={{ label: 'Retry', onClick: refresh }}
          />
        )}
        {!loading &&
          !errored &&
          steps.map((step) => (
            <StepRow
              key={step.id}
              step={step}
              open={openId === step.id}
              reduceMotion={reduceMotion}
              onToggle={() => toggle(step.id)}
            />
          ))}
      </div>
    </Sheet>
  );
}
