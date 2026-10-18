import { formatClock, type AvatarPersonInput } from '@zilar/chat-core';
import { defaultOpenStepId, stepsView, type DisplayStep } from '@zilar/client-core';
import type { Progress } from '@zilar/protocol';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useGlobalSearchParams } from 'expo-router';
import { Check, ChevronDown, ChevronRight, ShieldCheck, Square, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { EntityAvatar } from '@/components/chat/entity-avatar';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { IconButton } from '@/components/ui/icon-button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { createAgentTasksApi, type AgentTasksApi } from '@/lib/agent-tasks-api';
import { API_URL } from '@/lib/auth';
import { ACCENT, DANGER, ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { well } from '@/lib/depth';
import { fromApi } from '@zilar/client-core';
import { failureOf } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { getSessionToken } from '@/lib/session-token';
import { cn } from '@/lib/utils';
import { ENV_MOCK, apiMockActive, mockParamAllowed, mockToken } from '@/mock/gate';

// Builds the mock-mode `AgentTasksApi` behind a literal build-time condition: Metro folds it to `false` in a release build, so the mock stays out of the bundle.
function createMockAgentTasks(): AgentTasksApi {
  if (__DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { mockFetch } = require('@/mock/backend') as typeof import('@/mock/backend');
    return createAgentTasksApi(mockToken, mockFetch, API_URL);
  }
  throw new Error('The mock API is not part of this build');
}

function StepStateIcon({
  state,
  reduceMotion,
}: {
  state: DisplayStep['state'];
  reduceMotion: boolean;
}) {
  if (state === 'done') {
    return <Check size={16} color={ACCENT} aria-hidden />;
  }
  if (state === 'failed') {
    return <X size={16} color={DANGER} aria-hidden />;
  }
  if (state === 'doing') {
    return <ActivityIndicator size="small" color={ACCENT} animating={!reduceMotion} />;
  }
  return <Square size={16} color={MUTED_FOREGROUND} aria-hidden />;
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
  // Only a step with actions expands; one without shows no chevron and is not a toggle.
  const expandable = step.actions.length > 0;
  const Chevron = open ? ChevronDown : ChevronRight;
  const content = (
    <>
      <StepStateIcon state={step.state} reduceMotion={reduceMotion} />
      <Text numberOfLines={1} className="min-w-0 flex-1 text-[14px] font-medium text-foreground">
        {step.label}
      </Text>
      {step.approved ? (
        <ShieldCheck size={14} color={MUTED_FOREGROUND} accessibilityLabel="Approved" />
      ) : null}
      {step.durationMs !== null ? (
        <Text className="shrink-0 font-mono text-[12px] text-muted-foreground">
          {formatClock(step.durationMs)}
        </Text>
      ) : null}
      {expandable ? <Chevron size={16} color={MUTED_FOREGROUND} aria-hidden /> : null}
    </>
  );
  return (
    <View className={cn('rounded-[10px]', open && 'bg-surface-raised')}>
      {expandable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={onToggle}
          className="min-h-[52px] flex-row items-center gap-2.5"
        >
          {content}
        </Pressable>
      ) : (
        <View className="min-h-[52px] flex-row items-center gap-2.5">{content}</View>
      )}

      {open
        ? step.actions.map((action, index) => (
            <View key={`${step.id}:${index}`}>
              <View className="min-h-10 flex-row items-center gap-2.5 pl-7">
                {action.ok ? (
                  <Check size={14} color={ACCENT} aria-hidden />
                ) : (
                  <X size={14} color={DANGER} aria-hidden />
                )}
                <Text
                  numberOfLines={1}
                  className="min-w-0 flex-1 font-mono text-[13px] text-foreground"
                >
                  {action.command}
                </Text>
                <Text className="shrink-0 font-mono text-[12px] text-muted-foreground">
                  {formatClock(action.durationMs)}
                </Text>
              </View>
              {!action.ok && action.error !== undefined ? (
                <View style={well} className="mb-2 ml-7 rounded-lg px-2.5 py-2">
                  <Text className="font-mono text-[12px] leading-[17px] text-muted-foreground">
                    {action.error}
                  </Text>
                </View>
              ) : null}
            </View>
          ))
        : null}
    </View>
  );
}

// The phone's "View steps" sheet, the mobile twin of web's `StepsPanel`: the card's steps with the actions logged under each, opened from a finished card's "View steps" row. It never shows model calls, tokens, money or the answer. A 404 or an empty log (kept 30 days) falls back to the card's steps.
export function StepsSheet({
  visible,
  onClose,
  taskId,
  card,
  aiName,
  aiAvatarUrl,
}: {
  visible: boolean;
  onClose: () => void;
  taskId: string;
  card: Progress;
  aiName?: string | undefined;
  aiAvatarUrl?: string | undefined;
}) {
  const reduceMotion = useReducedMotion();
  const params = useGlobalSearchParams();
  const mock = apiMockActive(
    ENV_MOCK,
    params,
    mockParamAllowed({ dev: __DEV__, envMock: ENV_MOCK }),
  );
  const api = useMemo(
    () => (mock ? createMockAgentTasks() : createAgentTasksApi(getSessionToken)),
    [mock],
  );

  const [result, refresh] = useQuery(
    // Steps are fetched only while the sheet is open, so a chat full of finished cards makes no request per card; a reopen starts a new request.
    () => (visible ? fromApi(() => api.getTaskSteps(taskId)) : Effect.never),
    [api, taskId, visible],
  );
  const failure = AsyncResult.isFailure(result) ? failureOf(result) : undefined;
  const loaded = AsyncResult.isSuccess(result) ? result.value.steps : undefined;
  const { steps, loading, errored } = stepsView(loaded, failure?.status, card);

  // The step holding the first failed action starts open; the choice resets when the sheet closes.
  const defaultOpen = defaultOpenStepId(steps);
  const [chosenOpen, setChosenOpen] = useState<string | null>();
  const openId = chosenOpen === undefined ? defaultOpen : chosenOpen;
  const toggle = (id: string): void => setChosenOpen(openId === id ? null : id);
  const close = (): void => {
    setChosenOpen(undefined);
    onClose();
  };

  const aiPerson: AvatarPersonInput = {
    id: card.ai,
    name: aiName ?? card.ai,
    ...(aiAvatarUrl === undefined ? {} : { avatarUrl: aiAvatarUrl }),
  };

  return (
    <BottomSheet visible={visible} onClose={close} closeLabel="Close steps">
      <View className="flex-row items-center gap-2.5 border-b border-divider pb-3">
        <EntityAvatar person={aiPerson} size={28} ai />
        <Text
          numberOfLines={1}
          className="min-w-0 flex-1 text-[16px] font-semibold text-foreground"
        >
          {card.title ?? card.stage}
        </Text>
        {card.elapsed_ms !== undefined ? (
          <Text className="shrink-0 font-mono text-[12px] text-muted-foreground">
            {formatClock(card.elapsed_ms)}
          </Text>
        ) : null}
        <IconButton label="Close steps" onPress={close}>
          <X size={16} color={ICON} />
        </IconButton>
      </View>

      <View className="pt-1">
        {loading ? <StateMessage kind="loading" size="inline" title="Loading…" /> : null}
        {errored ? (
          <StateMessage
            kind="error"
            title="Could not load the steps."
            action={{ label: 'Retry', onPress: refresh }}
          />
        ) : null}
        {!loading && !errored
          ? steps.map((step) => (
              <StepRow
                key={step.id}
                step={step}
                open={openId === step.id}
                reduceMotion={reduceMotion}
                onToggle={() => toggle(step.id)}
              />
            ))
          : null}
      </View>
    </BottomSheet>
  );
}
