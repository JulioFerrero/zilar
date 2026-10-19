import {
  type ApprovalRequest,
  type Payload,
  type Progress,
  type ProgressStep,
  type Sticker,
  type Question,
  StickerSchema,
  isValid,
} from '@zilar/protocol';
import {
  approvalSentBy,
  interruptFiber,
  isCardAllowedFrom,
  makeAisApi,
  makeApprovalsApi,
} from '@zilar/client-core';
import { Effect, Schedule } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { Check, ChevronRight, Circle, CircleAlert, Repeat, Square, X } from 'lucide-react-native';
import { type ReactNode, useEffect, useState } from 'react';
import { ActivityIndicator, View, Pressable } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import type { BlockRespondTarget } from '@/components/chat/blocks/block-respond';
import { BlockCard } from '@/components/chat/blocks/block-card';
import { StepsSheet } from '@/components/chat/steps-sheet';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useApi } from '@/lib/use-mockable-api';
import type { ApprovalDecision, ApprovalStatus, PublicApproval } from '@zilar/api-contract';
import { applyDecision, loadApprovalCardState, type ApprovalCardState } from '@/lib/approval-state';
import { ACCENT, DANGER, MUTED_FOREGROUND, SEEN } from '@/lib/colors';
import { bubbleStyle } from '@/lib/depth';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import {
  answeredOption,
  elapsedFor,
  formatClock,
  isQuestionAnswer,
  routineCardTitle,
} from '@zilar/chat-core';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/store/chat-store-provider';

// The AI's question card: the question, then 2-4 reply chips. A chip sends a normal reply that @mentions the asking AI and quotes the question; after one tap the chips disable until the server closes the question. After a reload the answer is read back from the first loaded reply that quotes it.
function QuestionCard({ question }: { question: Question }) {
  const sendText = useChatStore((state) => state.sendText);
  // `PayloadCard` only sees the card, so the owning message is resolved here for the chat and message ids the reply quotes.
  const message = useChatStore((state) => {
    const chatId = state.activeChatId;
    if (chatId === null) {
      return undefined;
    }
    return state.messages(chatId).find((entry) => {
      const card = entry.card;
      return card?.type === 'question' && card.data.id === question.id;
    });
  });
  const reply = useChatStore((state) => {
    if (message === undefined) {
      return undefined;
    }
    return state.messages(message.chatId).find((entry) => isQuestionAnswer(entry, message));
  });
  const [answered, setAnswered] = useState(false);
  const picked =
    reply === undefined || message === undefined
      ? undefined
      : answeredOption(reply.text, message.senderName, question.options);
  const isAnswered = answered || reply !== undefined;
  const disabled = isAnswered || message === undefined;

  const answer = (option: string): void => {
    if (message === undefined || isAnswered) {
      return;
    }
    setAnswered(true);
    const aiName = message.senderName;
    sendText(message.chatId, `@${aiName} ${option}`, {
      replyTo: { id: message.id, senderName: aiName },
      mentions: [{ jid: question.ai, name: aiName, begin: 0, end: aiName.length + 1 }],
    });
  };

  return (
    <View className="gap-2 py-0.5">
      <Text className="text-[15px] text-foreground">{question.question}</Text>
      <View className="flex-row flex-wrap gap-2">
        {question.options.map((option) => (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityLabel={option}
            disabled={disabled}
            onPress={() => answer(option)}
            className={cn(
              'rounded-full border border-divider px-3.5 py-1.5',
              isAnswered && option === picked
                ? 'border-transparent bg-surface-raised'
                : isAnswered
                  ? 'opacity-50'
                  : 'active:bg-surface-raised',
            )}
          >
            <Text className="text-[15px] font-medium text-foreground">{option}</Text>
          </Pressable>
        ))}
      </View>
      {reply !== undefined && (
        <Text className="text-[13px] text-muted-foreground">{reply.senderName} answered</Text>
      )}
    </View>
  );
}

// Parses a `sticker` payload whose `data` passes `StickerSchema`; anything invalid falls back to the body text, so a hostile or drifted payload never breaks the list.
export function stickerOf(message: {
  card?: { type: string; data: unknown; v?: number } | undefined;
}): Sticker | undefined {
  const { card } = message;
  if (card === undefined || card.type !== 'sticker') {
    return undefined;
  }
  return isValid(StickerSchema)(card.data) ? card.data : undefined;
}

// The progress card alone: it renders without a bubble, like a sticker, so it carries the incoming surface itself and shows no time or "edited" row.
function ProgressCardSurface({ data }: { data: Progress }) {
  return (
    <View className="min-w-[240px] rounded-[12px] p-2.5" style={bubbleStyle('incoming', false)}>
      <ProgressCard data={data} />
    </View>
  );
}

export function PayloadCard({
  card,
  senderId,
  footer,
  respond,
  preview = false,
}: {
  card: Payload;
  // The sender of the message this card came on; the AI-only gate needs it. A preview row passes none.
  senderId?: string | undefined;
  footer?: ReactNode;
  // Who answers a `blocks` card; absent on own cards.
  respond?: BlockRespondTarget;
  // A topic-join preview row has no store message, so it draws only the display-only cards.
  preview?: boolean;
}) {
  const previewCard = preview && (card.type === 'blocks' || card.type === 'progress');
  // An AI-only card never renders unless its sender resolves to an AI, even when a caller bypassed the ledger's mapping. An unknown sender fails closed and falls back to text.
  if (preview ? !previewCard : senderId === undefined || !isCardAllowedFrom(card, senderId)) {
    return null;
  }
  switch (card.type) {
    case 'progress':
      return <ProgressCardSurface data={card.data} />;
    case 'approval.request':
      return <ApprovalCard data={card.data} senderId={senderId} />;
    case 'question':
      return <QuestionCard question={card.data} />;
    case 'blocks':
      return <BlockCard data={card.data} footer={footer} respond={respond} />;
    default:
      return null;
  }
}

// The card types `PayloadCard` draws; any other payload (`handoff.line`, a card from a newer build) falls through to the normal text body instead of an empty bubble.
const RENDERED_CARD_TYPES: ReadonlySet<string> = new Set([
  'progress',
  'approval.request',
  'question',
  'blocks',
]);

export function isRenderedCard(card: { type: string }): boolean {
  return RENDERED_CARD_TYPES.has(card.type);
}

interface DecidedCard {
  readonly api: ReturnType<typeof makeApprovalsApi>;
  readonly id: string;
  readonly approval: PublicApproval;
}

function ApprovalCard({
  data,
  senderId,
}: {
  data: ApprovalRequest;
  /** The message sender: the record's `aiId` must belong to it. */
  senderId?: string | undefined;
}) {
  const { api } = useApi(makeApprovalsApi);
  const [loaded] = useQuery(
    () => Effect.promise(() => loadApprovalCardState(api, data.id)),
    [api, data.id],
  );
  const [decided, setDecided] = useState<DecidedCard | null>(null);
  const [inFlight, setInFlight] = useState<null | 'approve' | 'deny' | 'always'>(null);
  // Two-step confirm: the first tap arms, the second decides.
  const [confirmingAlways, setConfirmingAlways] = useState(false);
  const [decision, decide] = useAction((next: ApprovalDecision) =>
    Effect.promise(() => applyDecision(api, data.id, next)).pipe(
      Effect.tap((outcome) =>
        Effect.sync(() => {
          if (
            (outcome.kind === 'ready' || outcome.kind === 'reloaded') &&
            outcome.approval !== null
          ) {
            setDecided({ api, id: data.id, approval: outcome.approval });
          }
        }),
      ),
      Effect.ensuring(Effect.sync(() => setInFlight(null))),
    ),
  );

  const loadedState: ApprovalCardState =
    AsyncResult.isSuccess(loaded) && !isWaiting(loaded) ? loaded.value : { kind: 'loading' };
  const state: ApprovalCardState =
    decided !== null && decided.api === api && decided.id === data.id
      ? { kind: 'ready', approval: decided.approval }
      : loadedState;
  const busy = inFlight !== null;
  const outcome =
    !isWaiting(decision) && AsyncResult.isSuccess(decision) ? decision.value : undefined;
  const actionError = outcome?.kind === 'error' ? outcome.message : '';

  const startDecision = (next: ApprovalDecision): void => {
    setInFlight(next === 'deny' ? 'deny' : next === 'approve_always' ? 'always' : 'approve');
    decide(next);
  };

  // The summary, action and AI come from the server's record, never from the
  // message; without a loaded record there is no card to act on.
  if (state.kind !== 'ready') {
    return (
      <View className="min-w-[230px] py-0.5">
        {state.kind === 'loading' ? (
          <View
            accessibilityRole="text"
            aria-hidden
            accessible={false}
            className="mt-1 h-7 w-32 rounded-md bg-surface-raised"
          />
        ) : (
          <Text className="text-[12px] text-muted-foreground">This request is not available</Text>
        )}
      </View>
    );
  }
  const approval = state.approval;
  // The read model turns a past-due `pending` row into `expired`, so `pending`
  // already means "not expired".
  const isPending = approval.status === 'pending';
  // A forged card can name a real approval but must not decide it: the server's
  // `aiId` has to belong to the message sender.
  const senderMatches = senderId !== undefined && approvalSentBy(approval.aiId, senderId);
  const showAlways = isPending && approval.alwaysEligible && senderMatches;

  const label = approval.aiName !== '' ? `${approval.aiName} asks` : 'Approval';

  const routine = routineCardTitle(approval.action, approval.summary);

  if (!isPending) {
    return (
      <View className="min-w-[230px] py-0.5">
        <View className="flex-row items-center gap-2">
          <DecidedIcon status={approval.status} />
          {routine === null ? (
            <Text className="min-w-0 flex-1 text-[14px] text-muted-foreground">
              {approval.summary}
            </Text>
          ) : (
            <>
              <Text className="min-w-0 flex-1 text-[14px] text-muted-foreground">
                {routine.title}
              </Text>
              <Text className="font-mono text-[12px] text-muted-foreground">
                {routine.schedule}
              </Text>
            </>
          )}
        </View>
      </View>
    );
  }

  return (
    <View className="min-w-[230px] gap-2 py-0.5">
      <View className="gap-1">
        <Text className="text-[13px] text-muted-foreground">{label}</Text>
        {routine === null ? (
          <Text className="text-[16px] font-semibold text-foreground">{approval.summary}</Text>
        ) : (
          <View className="flex-row items-center gap-2">
            <Repeat size={15} color={MUTED_FOREGROUND} aria-hidden />
            <Text className="min-w-0 flex-1 text-[16px] font-semibold text-foreground">
              {routine.title}
            </Text>
            <Text className="font-mono text-[12px] text-muted-foreground">{routine.schedule}</Text>
          </View>
        )}
      </View>

      {isPending ? (
        <View className="gap-2">
          <View className="flex-row gap-2">
            <Button
              variant="outline"
              className="h-11 flex-1"
              disabled={busy || !senderMatches}
              accessibilityLabel="Deny"
              onPress={() => startDecision('deny')}
            >
              <Text>{inFlight === 'deny' ? 'Denying…' : 'Deny'}</Text>
            </Button>
            <Button
              variant="key"
              className="h-11 flex-1"
              disabled={busy || !senderMatches}
              accessibilityLabel="Approve"
              onPress={() => startDecision('approve_once')}
            >
              <Text>{inFlight === 'approve' ? 'Approving…' : 'Approve'}</Text>
            </Button>
          </View>

          {showAlways ? (
            <Button
              variant="ghost"
              className="h-9 self-center px-2"
              disabled={busy || !senderMatches}
              accessibilityLabel="Always allow"
              onPress={() =>
                confirmingAlways ? startDecision('approve_always') : setConfirmingAlways(true)
              }
            >
              <Text className="text-[13px] font-medium text-muted-foreground">
                {inFlight === 'always'
                  ? 'Allowing…'
                  : confirmingAlways
                    ? 'Tap again to always allow'
                    : 'Always allow'}
              </Text>
            </Button>
          ) : null}

          {actionError !== '' ? (
            <Text className="text-[12px] text-muted-foreground">{actionError}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function DecidedIcon({ status }: { status: ApprovalStatus }) {
  if (status === 'denied' || status === 'expired') {
    return <X size={14} color={DANGER} aria-hidden />;
  }
  return <Check size={14} color={SEEN} aria-hidden />;
}

/** A card without a terminal state is still working. */
function isLive(state: Progress['state']): boolean {
  return state === undefined || state === 'working';
}

function StateIcon({ state, reduceMotion }: { state: Progress['state']; reduceMotion: boolean }) {
  if (state === 'done') {
    return <Check size={16} color={ACCENT} aria-hidden />;
  }
  if (state === 'failed') {
    return <CircleAlert size={16} color={DANGER} aria-hidden />;
  }
  if (state === 'stopped') {
    return <Square size={16} color={MUTED_FOREGROUND} aria-hidden />;
  }
  return <ActivityIndicator size="small" color={ACCENT} animating={!reduceMotion} />;
}

function StepIcon({
  state,
  reduceMotion,
}: {
  state: ProgressStep['state'];
  reduceMotion: boolean;
}) {
  if (state === 'done') {
    return <Check size={14} color={ACCENT} aria-hidden />;
  }
  if (state === 'failed') {
    return <X size={14} color={DANGER} aria-hidden />;
  }
  if (state === 'doing') {
    return <ActivityIndicator size="small" color={ACCENT} animating={!reduceMotion} />;
  }
  return <Circle size={14} color={MUTED_FOREGROUND} aria-hidden />;
}

// The task card: one collapsed line that expands to the step checklist and summary. Without `steps` it falls back to the old `stage`/`detail` shape, so an old server still renders.
function ProgressCard({ data }: { data: Progress }) {
  const reduceMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const ticking = isLive(data.state) && data.started_at !== undefined;

  useEffect(() => {
    if (!ticking) {
      return;
    }
    // A ticking `now` as an Effect fiber per repo rule, no `setInterval`.
    const tick = Effect.sync(() => setNow(Date.now()));
    const timer = Effect.runFork(
      Effect.repeat(tick, Schedule.spaced(1000)).pipe(Effect.delay(1000), Effect.asVoid),
    );
    return () => {
      interruptFiber(timer);
    };
  }, [ticking]);

  const live = isLive(data.state);
  const elapsed = elapsedFor(data, now);
  const steps = data.steps ?? [];
  const expandable = steps.length > 0;
  const taskId = data.task_id;

  // Stop shows only for a working card the viewer can stop: the server set `can_stop` and the AI belongs to the viewer.
  const { api } = useApi(makeAisApi);
  const chatJid = useChatStore((state) => state.activeChatId);
  const [ownedResult] = useQuery(() => Effect.promise(() => api.listAis()), [api, data.ai]);
  const ownedAi = AsyncResult.isSuccess(ownedResult)
    ? (ownedResult.value.find((ai) => ai.jid === data.ai) ?? null)
    : null;
  const stoppable = isLive(data.state) && data.can_stop === true && ownedAi !== null;
  // The card the stop was tapped on: "Stopping…" lasts until the next edit.
  const [stoppedFor, setStoppedFor] = useState<Progress | null>(null);
  const stopping = stoppedFor === data;
  const stop = (): void => {
    if (ownedAi === null || chatJid === null || stopping) {
      return;
    }
    setStoppedFor(data);
    void api.stopAiTurn(ownedAi.id, chatJid).catch(() => {
      // The card's next edit never came; let the owner try again.
      setStoppedFor(null);
    });
  };

  const header = (
    <>
      <StateIcon state={data.state} reduceMotion={reduceMotion} />
      <Text numberOfLines={2} className="min-w-0 shrink text-[15px] font-semibold text-foreground">
        {data.title ?? data.stage}
      </Text>
      {/* A `flex-1` spacer (basis 0) pushes the timer and the key to the right
          without shrinking the title, which now sizes by its full text width. */}
      <View className="flex-1" />
      {elapsed === undefined ? null : (
        <Text className="shrink-0 font-mono text-[12px] text-muted-foreground">
          {formatClock(elapsed)}
        </Text>
      )}
    </>
  );

  const stopKey = stoppable ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={stopping ? 'Stopping' : 'Stop task'}
      disabled={stopping}
      onPress={stop}
      className="shrink-0 flex-row items-center gap-1 rounded-full px-2 py-0.5"
    >
      <Square size={14} color={MUTED_FOREGROUND} aria-hidden />
      <Text className="text-[12px] font-medium text-muted-foreground">
        {stopping ? 'Stopping…' : 'Stop'}
      </Text>
    </Pressable>
  ) : null;

  const stepList = (
    <View className="gap-1.5">
      {steps.map((step) => (
        <View key={step.id} className="flex-row items-center gap-2">
          <StepIcon state={step.state} reduceMotion={reduceMotion} />
          <Text className="min-w-0 flex-1 text-[14px] text-foreground">{step.label}</Text>
        </View>
      ))}
      {data.summary ? (
        <Text className="text-[13px] leading-4 text-muted-foreground">{data.summary}</Text>
      ) : null}
    </View>
  );

  // A finished card is one pressable line: state icon, full title, duration and chevron. A press opens the full steps for the viewer's own AI, and expands them otherwise.
  const ownedTask = ownedAi !== null && taskId !== undefined ? { taskId, ai: ownedAi } : undefined;
  if (!live) {
    const pressable = ownedTask !== undefined || expandable;
    return (
      <View className="self-stretch gap-1.5 py-0.5">
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={ownedTask === undefined ? 'Show steps' : 'View steps'}
          disabled={!pressable}
          onPress={() => {
            if (ownedTask === undefined) {
              setExpanded((open) => !open);
            } else {
              setStepsOpen(true);
            }
          }}
          className="flex-row items-center gap-2"
        >
          {header}
          {pressable ? <ChevronRight size={16} color={MUTED_FOREGROUND} aria-hidden /> : null}
        </Pressable>
        {expandable && expanded ? stepList : null}
        {ownedTask === undefined ? null : (
          <StepsSheet
            visible={stepsOpen}
            onClose={() => setStepsOpen(false)}
            taskId={ownedTask.taskId}
            card={data}
            aiName={ownedTask.ai.name}
            aiAvatarUrl={ownedTask.ai.avatarUrl}
          />
        )}
      </View>
    );
  }

  return (
    <View className="self-stretch gap-1.5 py-0.5">
      <View className="flex-row items-center gap-2">
        {header}
        {stopKey}
      </View>

      {expandable ? (
        stepList
      ) : (
        <>
          {data.title ? (
            <Text className="text-[14px] text-muted-foreground">{data.stage}</Text>
          ) : null}
          {data.detail ? (
            <Text className="text-[13px] leading-4 text-muted-foreground">{data.detail}</Text>
          ) : null}
        </>
      )}
    </View>
  );
}
