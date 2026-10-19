import { ApiError, type MyRoutine } from '@zilar/api-contract';
import { Effect } from 'effect';
import { useRouter } from 'expo-router';
import { Repeat, MessageCircle, Pause, Play, Trash2 } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, View, Pressable } from 'react-native';

import { RequireAuth } from '@/auth/RequireAuth';
import { AisScreenShell } from '@/components/ais/screen-shell';
import { useFocusList } from '@/components/settings/use-focus-list';
import { useApi } from '@/lib/use-mockable-api';
import { SectionLabel } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { MUTED_FOREGROUND, DANGER, ICON } from '@/lib/colors';
import { makeToolsApi } from '@zilar/client-core';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { EntityAvatar } from '@/components/chat/entity-avatar';
import { IconButton } from '@/components/ui/icon-button';
import { cn } from '@/lib/utils';
import { routineActionMessage } from '@/components/ais/use-routine-actions';
import type { RoutineAction, RoutineActionMessage } from '@/components/ais/use-routine-actions';
import { describeRoutineSchedule } from '@zilar/chat-core';

type RoutineRowProps = {
  routine: MyRoutine;
  busy: boolean;
  revealed: boolean;
  divider: boolean;
  onToggle: () => void;
  onAsk: () => void;
  onTogglePause: () => void;
  onAskDelete: () => void;
};

function RoutineRow({
  routine,
  busy,
  revealed,
  divider,
  onToggle,
  onAsk,
  onTogglePause,
  onAskDelete,
}: RoutineRowProps) {
  const running = routine.status === 'active';
  const chatJid = routine.chatJid;
  return (
    <View
      className={cn(
        'flex-row items-center gap-2 px-3 py-2.5',
        divider && 'border-b border-divider',
      )}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${routine.title}, ${running ? 'running' : 'paused'}`}
        accessibilityState={{ expanded: revealed }}
        onPress={onToggle}
        className="min-w-0 flex-1 flex-row items-center gap-3"
      >
        <EntityAvatar
          person={{
            id: routine.aiId ?? routine.id,
            name: routine.aiName,
            avatarUrl: routine.aiAvatarUrl,
          }}
          size={36}
          ai
        />
        <View className="min-w-0 flex-1 gap-0.5">
          <View className="min-w-0 flex-row items-center gap-2">
            <View
              accessibilityRole="image"
              accessibilityLabel={running ? 'Running' : 'Paused'}
              className={cn(
                'h-2 w-2 shrink-0 rounded-full',
                running ? 'bg-online' : 'bg-muted-foreground',
              )}
            />
            <Text numberOfLines={1} className="text-[15px] font-medium">
              {routine.title}
            </Text>
          </View>
          <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
            <Text className="font-mono">{describeRoutineSchedule(routine.schedule)}</Text>
            {' · '}
            {routine.aiName}
          </Text>
        </View>
      </Pressable>

      {chatJid === null ? null : (
        <IconButton
          label={`Ask ${routine.aiName} about ${routine.title}`}
          disabled={busy}
          onPress={onAsk}
        >
          <MessageCircle size={18} color={ICON} />
        </IconButton>
      )}

      <IconButton
        label={`${running ? 'Pause' : 'Resume'} ${routine.title}`}
        disabled={busy}
        onPress={onTogglePause}
      >
        {running ? <Pause size={18} color={ICON} /> : <Play size={18} color={ICON} />}
      </IconButton>

      {revealed ? (
        <IconButton
          label={`Delete ${routine.title}`}
          className="text-danger"
          disabled={busy}
          onPress={onAskDelete}
        >
          <Trash2 size={18} color={DANGER} />
        </IconButton>
      ) : null}
    </View>
  );
}

/** A fixed sentence, never server text. */
const LIST_FAILED_MESSAGE = 'Could not load your routines. Try again.';

/** A 404 or an unparseable response reads as an empty list, not an error, like the per-AI routines section. */
function loadMyRoutinesEffect(
  api: ReturnType<typeof makeToolsApi>,
): Effect.Effect<MyRoutine[], unknown> {
  return Effect.tryPromise({ try: () => api.listMyRoutines(), catch: (cause) => cause }).pipe(
    Effect.catch((error) =>
      error instanceof ApiError && (error.status === 404 || error.code === 'invalid_response')
        ? Effect.succeed<MyRoutine[]>([])
        : Effect.fail(error),
    ),
  );
}

export default function RoutinesScreen() {
  return (
    <RequireAuth>
      <RoutinesBody />
    </RequireAuth>
  );
}

function RoutinesBody() {
  const router = useRouter();
  const { api } = useApi(makeToolsApi);
  const { data, status, error, refreshing, refresh, reload } = useFocusList<MyRoutine[]>(() =>
    loadMyRoutinesEffect(api).pipe(Effect.mapError(() => LIST_FAILED_MESSAGE)),
  );
  const routines = data ?? [];

  const [notice, setNotice] = useState<RoutineActionMessage | null>(null);
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const [actionState, runAction] = useAction(
    (work: { action: RoutineAction; id: string }) =>
      Effect.tryPromise({
        try: async () => {
          if (work.action === 'delete') {
            await api.deleteRoutine(work.id);
            return;
          }
          if (work.action === 'pause') {
            await api.pauseRoutine(work.id);
            return;
          }
          await api.resumeRoutine(work.id);
        },
        catch: (cause) => cause,
      }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            setNotice(null);
            setRevealedId(null);
            setConfirmingId(null);
            reload();
          }),
        ),
        Effect.tapError((error) =>
          Effect.sync(() => {
            setConfirmingId(null);
            setNotice(routineActionMessage(error));
          }),
        ),
      ),
    { mode: 'replace' },
  );
  const busy = isWaiting(actionState);

  const running = routines.filter((routine) => routine.status === 'active');
  const paused = routines.filter((routine) => routine.status !== 'active');

  const rowActions = (routine: MyRoutine, divider: boolean) => (
    <RoutineRow
      key={routine.id}
      routine={routine}
      busy={busy}
      revealed={revealedId === routine.id}
      divider={divider}
      onToggle={() => {
        setConfirmingId(null);
        setRevealedId((current) => (current === routine.id ? null : routine.id));
      }}
      onAsk={() => {
        if (routine.chatJid !== null) {
          router.push({ pathname: '/chat/[id]', params: { id: routine.chatJid } });
        }
      }}
      onTogglePause={() =>
        runAction({ action: routine.status === 'active' ? 'pause' : 'resume', id: routine.id })
      }
      onAskDelete={() => setConfirmingId(routine.id)}
    />
  );

  return (
    <AisScreenShell title="Routines" onBack={() => router.back()}>
      {status === 'loading' ? <StateMessage kind="loading" title="Loading routines…" /> : null}

      {status === 'error' ? (
        <StateMessage
          kind="error"
          title={error ?? LIST_FAILED_MESSAGE}
          action={{
            label: 'Retry',
            accessibilityLabel: 'Retry loading routines',
            onPress: reload,
          }}
        />
      ) : null}

      {status === 'ready' ? (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 24 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={MUTED_FOREGROUND}
              onRefresh={refresh}
            />
          }
        >
          {routines.length === 0 ? (
            <StateMessage kind="empty" icon={Repeat} title="No routines yet" />
          ) : (
            <View className="gap-6">
              {running.length > 0 ? (
                <RoutineGroup label="Running">
                  {running.map((routine, index) => rowActions(routine, index < running.length - 1))}
                </RoutineGroup>
              ) : null}
              {paused.length > 0 ? (
                <RoutineGroup label="Paused">
                  {paused.map((routine, index) => rowActions(routine, index < paused.length - 1))}
                </RoutineGroup>
              ) : null}
            </View>
          )}

          {notice === null ? null : notice.kind === 'hint' ? (
            <Text role="status" className="mt-3 px-2 text-[13px] text-muted-foreground">
              {notice.text}
            </Text>
          ) : (
            <Text role="status" className="mt-3 px-2 text-[13px] text-danger">
              {notice.text}
            </Text>
          )}
        </ScrollView>
      ) : null}

      <ConfirmDialog
        visible={confirmingId !== null}
        title="Delete this routine?"
        message="The routine stops running and is removed for good. This cannot be undone."
        confirmLabel="Delete"
        busyLabel="Deleting…"
        busy={busy}
        onCancel={() => setConfirmingId(null)}
        onConfirm={() => {
          if (confirmingId !== null) {
            runAction({ action: 'delete', id: confirmingId });
          }
        }}
        confirmAccessibilityLabel="Confirm delete routine"
        accessibilityLabel="Delete routine"
      />
    </AisScreenShell>
  );
}

function RoutineGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View accessibilityLabel={label} className="gap-2">
      <SectionLabel>{label}</SectionLabel>
      <View className="overflow-hidden rounded-2xl border border-border bg-surface">
        {children}
      </View>
    </View>
  );
}
