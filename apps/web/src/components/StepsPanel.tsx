import type { Contact, TaskStep, TaskStepAction } from '@zilar/api-contract';
import type { AvatarPersonInput, ChatSummary } from '@zilar/chat-core';
import type { Progress } from '@zilar/protocol';
import { AsyncResult } from 'effect/reactivity';
import {
  Check,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  ShieldCheck,
  Square,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { getTaskSteps } from '@/lib/api/agent-tasks';
import { fromApi } from '@/lib/effect/api-effect';
import { failureOf } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { formatClock } from '@/lib/format-duration';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { cn } from '@/lib/utils';
import { useChatSelector } from '@/store/ChatStoreProvider';
import { EntityAvatar } from './EntityAvatar';
import { IconButton } from './ui/icon-button';
import { Sheet } from './ui/sheet';
import { StateMessage } from './ui/state-message';
import { Well } from './ui/well';

/** One rendered row: the server's step, or a card step when the log is gone. */
interface DisplayStep {
  id: string;
  label: string;
  state: TaskStep['state'];
  /** Absent on a card-only fallback step, which carries no duration. */
  durationMs: number | null;
  approved: boolean;
  actions: readonly TaskStepAction[];
}

function toDisplayStep(step: TaskStep): DisplayStep {
  return {
    id: step.id,
    label: step.label,
    state: step.state,
    durationMs: step.durationMs,
    approved: step.approved,
    actions: step.actions,
  };
}

/** The card's own steps, with no actions, when the log is empty or gone. */
function fallbackSteps(card: Progress | undefined): DisplayStep[] {
  return (card?.steps ?? []).map((step) => ({
    id: step.id,
    label: step.label,
    state: step.state === 'planned' ? 'stopped' : step.state,
    durationMs: null,
    approved: false,
    actions: [],
  }));
}

/**
 * The header's AI picture comes from the card's AI, never the chat: in a group
 * topic the chat is the group. The AI is found by its JID in the contacts, then
 * the chat rows; otherwise its name (the card message's sender, or the JID) is
 * enough for the orb.
 */
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

/** The state icon of one step row; a status is never a word. */
function StepStateIcon({
  state,
  reduceMotion,
}: {
  state: DisplayStep['state'];
  reduceMotion: boolean;
}) {
  const className = 'size-4 shrink-0';
  if (state === 'done') {
    return <Check className={cn(className, 'text-accent')} aria-hidden="true" />;
  }
  if (state === 'failed') {
    return <X className={cn(className, 'text-danger')} aria-hidden="true" />;
  }
  if (state === 'doing') {
    return (
      <LoaderCircle
        className={cn(
          className,
          'text-accent',
          !reduceMotion && 'animate-spin',
          reduceMotion && 'spinner-reduced',
        )}
        aria-hidden="true"
      />
    );
  }
  return <Square className={cn(className, 'text-muted-foreground')} aria-hidden="true" />;
}

/** One step: its header toggles the actions logged under it. */
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
  // Only a step with actions expands; one without shows no chevron and is not
  // a toggle.
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
 * The Steps panel (T-1535): the card's own steps with the actions logged under
 * each, opened from a finished card's "View steps" row. The panel lists the
 * same steps as the card — never model calls, tokens, money or the answer — and
 * reads the card's title, total and AI from the card message. A 404 or an empty log
 * (the log is kept 30 days) falls back to the card's steps with no actions.
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
  const gone = loaded === undefined ? failure?.status === 404 : loaded.length === 0;
  const steps: DisplayStep[] =
    loaded !== undefined && loaded.length > 0
      ? loaded.map(toDisplayStep)
      : gone
        ? fallbackSteps(card)
        : [];
  const loading = loaded === undefined && failure === undefined;
  const errored = failure !== undefined && failure.status !== 404;

  // The step holding the first failed action starts open, until the reader
  // picks another one.
  const defaultOpen = steps.find((step) => step.actions.some((action) => !action.ok))?.id ?? null;
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
