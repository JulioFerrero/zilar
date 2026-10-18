import { ApiError } from '@zilar/api-contract';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ROUTINES_LOAD_FAILED_MESSAGE,
  RoutinesSectionContent,
  type RoutinesSectionState,
} from '@/components/ais/routines-section';
import { ToolsSectionContent, sectionStateOf } from '@/components/ais/tools-section';
import { useRoutineActions } from '@/components/ais/use-routine-actions';
import { useToolsApi } from '@/components/ais/use-tools-api';
import { ScreenHeader } from '@/components/ui/screen-header';
import { useQuery } from '@/lib/effect/use-query';
import { mayManageRoles } from '@/lib/roles';
import type { Routine, ToolListItem, ToolsApi } from '@/lib/tools-api';
import { useChatStore } from '@/store/chat-store-provider';

const isEmptyListError = (error: unknown): boolean =>
  error instanceof ApiError && (error.status === 404 || error.code === 'invalid_response');

const loadTools = (api: ToolsApi, groupId: string, topicId?: string) =>
  Effect.tryPromise({
    try: () => (topicId === undefined ? api.listGroupTools(groupId) : api.listTopicTools(topicId)),
    catch: (error) => error,
  }).pipe(Effect.catchIf(isEmptyListError, () => Effect.succeed<ToolListItem[]>([])));

const loadRoutines = (api: ToolsApi, groupId: string, topicId?: string) =>
  Effect.tryPromise({
    try: () =>
      topicId === undefined ? api.listGroupRoutines(groupId) : api.listTopicRoutines(topicId),
    catch: (cause) => cause,
  }).pipe(Effect.catchIf(isEmptyListError, () => Effect.succeed<Routine[]>([])));

function routinesStateOf(
  load: AsyncResult.AsyncResult<Routine[], unknown>,
  routines: Routine[],
): RoutinesSectionState {
  if (AsyncResult.isSuccess(load)) {
    return { status: 'ready', routines, message: '' };
  }
  if (AsyncResult.isFailure(load)) {
    return { status: 'error', routines: [], message: ROUTINES_LOAD_FAILED_MESSAGE };
  }
  return { status: 'loading', routines: [], message: '' };
}

export function ToolsPage({
  groupId,
  topicId,
  onBack,
}: {
  groupId: string;
  topicId?: string;
  onBack: () => void;
}) {
  const { api } = useToolsApi();
  const [toolsLoad, reloadTools] = useQuery(
    () => loadTools(api, groupId, topicId),
    [api, groupId, topicId],
  );
  const [routinesLoad, reloadRoutines] = useQuery(
    () => loadRoutines(api, groupId, topicId),
    [api, groupId, topicId],
  );

  // A manager acts on the group's routines, like web's group panel; everyone
  // else reads the list and the server would refuse a write anyway.
  const currentUserId = useChatStore((state) => state.currentUserId);
  const members = useChatStore((state) => state.groupDetail(groupId)?.members);
  const canManage = mayManageRoles(
    members?.find((member) => member.userId === currentUserId)?.role,
  );

  // The actions edit the loaded list in place; a Retry reloads it and drops
  // the local edits (the query result changes, so the override is cleared).
  const loadedRoutines = AsyncResult.isSuccess(routinesLoad) ? routinesLoad.value : undefined;
  const [editedRoutines, setEditedRoutines] = useState<Routine[] | null>(null);
  const [seenLoad, setSeenLoad] = useState(routinesLoad);
  if (seenLoad !== routinesLoad) {
    setSeenLoad(routinesLoad);
    setEditedRoutines(null);
  }
  const routines = editedRoutines ?? loadedRoutines ?? [];

  const actions = useRoutineActions({ api, routines, onRoutines: setEditedRoutines });

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScreenHeader variant="sub" title="Tools and routines" onBack={onBack} />

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View className="gap-3 px-4 pt-1">
          <ToolsSectionContent state={sectionStateOf(toolsLoad, [])} onRetry={reloadTools} />
          <RoutinesSectionContent
            state={routinesStateOf(routinesLoad, routines)}
            onRetry={reloadRoutines}
            actions={canManage ? actions : undefined}
            action={canManage ? actions.action : null}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
