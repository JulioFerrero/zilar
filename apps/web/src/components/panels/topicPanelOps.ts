import type { ChatSummary } from '@zilar/chat-core';
import { Effect } from 'effect';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  ApiError,
  listTopicAis,
  listTopicMembers,
  listTopicTools,
  type GroupDetail,
  type PublicAi,
  type TopicAi,
  type TopicMember,
  type TopicTool,
} from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { ApiFailure, isApiFailureCode, toApiFailure } from '@/lib/effect/errors';
import { useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import { failInline, textOf } from './topic-failure';

export type PanelStatus = 'loading' | 'ready' | 'error';

/**
 * A chat-store action. The store throws an ApiError (mapped as fromApi maps
 * it) or a plain Error whose message is the user-facing sentence, which keeps
 * its text. Any other cause becomes the unknown failure, so `textOf` shows the
 * fixed fallback.
 */
export const storeCall = <A>(call: () => Promise<A>): Effect.Effect<A, ApiFailure> =>
  Effect.tryPromise({
    try: call,
    catch: (cause) =>
      cause instanceof Error && !(cause instanceof ApiError)
        ? new ApiFailure({ status: 0, code: 'store_error', message: cause.message, detail: {} })
        : toApiFailure(cause),
  });

/** The shown state of one loaded list. */
type ListState<Item> = {
  status: PanelStatus;
  items: Item[];
  message: string;
};

/** One list on the panel: a shown list stays on screen while it reloads, and
 *  `keepReadyOnDrop` decides whether the rows left after a failed re-read stay
 *  visible. */
function useListLoader<Item, Id>({
  load,
  fallback,
  deps,
  idOf,
  keepReadyOnDrop,
}: {
  load: () => Promise<Item[]>;
  fallback: string;
  deps: ReadonlyArray<unknown>;
  idOf: (item: Item) => Id;
  keepReadyOnDrop: (previous: readonly Item[]) => boolean;
}) {
  const [state, setState] = useState<ListState<Item>>({
    status: 'loading',
    items: [],
    message: '',
  });

  const setFailure = (failure: ApiFailure): void =>
    setState({ status: 'error', items: [], message: textOf(failure, fallback) });

  // `onShown` runs in the same step as the list update, so a row or picker
  // that the update removes has finished its last step.
  const fetch = (onShown: () => void = () => undefined): Effect.Effect<void, ApiFailure> =>
    fromApi(load).pipe(
      Effect.tap((items) =>
        Effect.sync(() => {
          setState({ status: 'ready', items, message: '' });
          onShown();
        }),
      ),
      Effect.asVoid,
    );

  const loadEffect = Effect.sync(() =>
    setState((previous) =>
      previous.status === 'ready' ? previous : { status: 'loading', items: [], message: '' },
    ),
  ).pipe(
    Effect.andThen(fetch()),
    Effect.catchTag('ApiFailure', (failure) => Effect.sync(() => setFailure(failure))),
  );
  const [, refresh] = useQuery(() => loadEffect, deps);

  // The list re-read after an action: a failure shows the list's inline error,
  // and `done` runs in the same step either way.
  const reloadAfter = (done: () => void = () => undefined): Effect.Effect<void> =>
    fetch(done).pipe(
      Effect.catchTag('ApiFailure', (failure) =>
        Effect.sync(() => {
          setFailure(failure);
          done();
        }),
      ),
    );

  const dropItem = (id: Id): void =>
    setState((previous) => ({
      status: previous.status === 'ready' && keepReadyOnDrop(previous.items) ? 'ready' : 'error',
      items: previous.items.filter((item) => idOf(item) !== id),
      message: 'Could not refresh the list.',
    }));

  return { state, refresh, fetch, reloadAfter, dropItem };
}

/**
 * Removes one row: the store call, then a re-read of the list. A 404 with
 * `onMissing` runs the "the row may be gone" path instead of failing. A
 * re-read that fails after a successful delete drops the row locally: never
 * show a removed row as if the delete failed.
 */
function removeRow<Id>({
  call,
  reload,
  drop,
  onMissing,
}: {
  call: (id: Id) => Promise<unknown>;
  reload: () => Effect.Effect<void, ApiFailure>;
  drop: (id: Id) => void;
  onMissing?: () => Effect.Effect<void, ApiFailure>;
}): (id: Id) => Effect.Effect<void, ApiFailure> {
  return (id) =>
    storeCall(() => call(id)).pipe(
      Effect.matchEffect({
        onFailure: (failure: ApiFailure): Effect.Effect<void, ApiFailure> =>
          onMissing !== undefined && failure.status === 404 ? onMissing() : Effect.fail(failure),
        onSuccess: (): Effect.Effect<void> =>
          reload().pipe(Effect.catchTag('ApiFailure', () => Effect.sync(() => drop(id)))),
      }),
    );
}

/**
 * The topic info panel's state and actions: the members and AIs lists, the
 * tools / my-AIs reads, the pickers, the confirm dialogs and the store calls.
 * `TopicPanelBody` renders what this returns.
 */
export function useTopicPanelOps({
  chat,
  topic,
  onClose,
}: {
  chat: ChatSummary;
  topic: NonNullable<ChatSummary['topic']>;
  onClose: () => void;
}) {
  const storeApi = useChatStoreApi();
  const info: GroupDetail | undefined = useChatSelector((s) => s.groupInfo(chat.id));
  const me = useChatSelector((s) => s.currentUserId);
  const navigate = useNavigate();

  const topicId = topic.id;
  const groupTitle = chat.groupTitle ?? info?.title ?? '';
  const meRole = info?.members.find((member) => member.userId === me)?.role;
  const isManager = meRole === 'owner' || meRole === 'admin';

  const members = useListLoader<TopicMember, string>({
    load: () => listTopicMembers(topicId),
    fallback: 'Could not load the members.',
    deps: [topicId],
    idOf: (member) => member.userId,
    keepReadyOnDrop: (previous) => previous.length > 1,
  });
  const ais = useListLoader<TopicAi, string>({
    load: () => listTopicAis(topicId),
    fallback: 'Could not load the AIs.',
    deps: [topicId],
    idOf: (ai) => ai.id,
    keepReadyOnDrop: (previous) => previous.length > 0,
  });

  const [toolsCount, setToolsCount] = useState<number | null>(null);
  const [myAis, setMyAis] = useState<PublicAi[]>([]);
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [aiPickerOpen, setAiPickerOpen] = useState(false);
  const [confirmingVisibility, setConfirmingVisibility] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [memoryAi, setMemoryAi] = useState<{ id: string; name: string } | undefined>(undefined);

  useEffect(() => {
    storeApi.getState().refreshGroupInfo(chat.id);
  }, [storeApi, chat.id]);

  useQuery(
    () =>
      fromApi(() => listTopicTools(topicId)).pipe(
        Effect.tap((tools: TopicTool[]) => Effect.sync(() => setToolsCount(tools.length))),
        Effect.catchTag('ApiFailure', () => Effect.sync(() => setToolsCount(null))),
      ),
    [topicId],
  );

  useQuery(
    () =>
      storeCall(() => storeApi.getState().listMyAis()).pipe(
        Effect.tap((list) =>
          Effect.sync(() => setMyAis(list.filter((ai) => ai.status === 'active'))),
        ),
        Effect.catchTag('ApiFailure', () => Effect.sync(() => setMyAis([]))),
      ),
    [storeApi],
  );

  const clearError = Effect.sync(() => setErrorMessage(''));

  // The row re-check after a removal 404. A superseded refresh (the store
  // restarted mid-flight) rejects with `stale_refresh` instead of merging:
  // retry once so a transient restart does not surface the store's
  // "superseded" wording in the panel; a second supersede is genuinely
  // stale state, so report a generic message the user can act on.
  const refreshTopicRowOnce = (): Effect.Effect<boolean, ApiFailure> => {
    const recheck = storeCall(() => storeApi.getState().refreshTopicRow(chat.id, topic.id));
    return recheck.pipe(
      Effect.catchIf(isApiFailureCode('stale_refresh'), () =>
        recheck.pipe(
          Effect.catchIf(isApiFailureCode('stale_refresh'), () =>
            Effect.fail(
              new ApiFailure({
                status: 0,
                code: 'stale_refresh',
                message: 'Could not refresh the topic. Try again.',
                detail: {},
              }),
            ),
          ),
        ),
      ),
    );
  };

  const closeTopicScreen = Effect.sync(() => {
    navigate('/');
    onClose();
  });

  // A 404 alone never means "the topic is gone" — the server also 404s for a
  // user who is not a member — so only navigate away when the refreshed list
  // no longer has the topic row. Any other failure keeps the user here with
  // the inline error.
  const afterMissingMember = (): Effect.Effect<void, ApiFailure> =>
    refreshTopicRowOnce().pipe(
      Effect.flatMap((gone) => (gone ? closeTopicScreen : members.reloadAfter())),
    );

  // ONE call: the store issues the POST and folds the row back in. The
  // picker closes in the same step as the list update.
  const addMember = (userId: string): Effect.Effect<void, ApiFailure> =>
    storeCall(() => storeApi.getState().addTopicMember(chat.id, userId)).pipe(
      Effect.andThen(members.reloadAfter(() => setMemberPickerOpen(false))),
    );

  // ONE call: the store issues the DELETE and folds the row back in (real)
  // or drops it when archived (both). A 404 alone never means "the topic is
  // gone" (see afterMissingMember).
  const removeMember = removeRow<string>({
    call: (userId) => storeApi.getState().removeTopicMember(chat.id, userId),
    reload: () => members.fetch(),
    drop: members.dropItem,
    onMissing: afterMissingMember,
  });

  // ONE call: the store issues the POST and folds the row back in.
  const addAi = (aiId: string): Effect.Effect<void, ApiFailure> =>
    storeCall(() => storeApi.getState().addTopicAi(chat.id, aiId)).pipe(
      Effect.andThen(ais.reloadAfter(() => setAiPickerOpen(false))),
    );

  // ONE call: the store issues the DELETE and folds the row back in. The
  // reload may fail after a successful delete (transient network): never show
  // the removed row as if the delete failed.
  const removeAi = removeRow<string>({
    call: (aiId) => storeApi.getState().removeTopicAi(chat.id, aiId),
    reload: () => ais.fetch(),
    drop: ais.dropItem,
  });

  const leaveEffect = storeCall(() => storeApi.getState().leaveTopic(chat.id)).pipe(
    // The store's `leaveTopic` swallows the last-seat 404 itself (the topic
    // archived, so there is nothing left to leave): success means the caller
    // is out either way, so navigate away.
    Effect.andThen(closeTopicScreen),
  );

  const archiveEffect = storeCall(() =>
    storeApi.getState().patchTopic(chat.id, { archived: true }),
  ).pipe(
    Effect.matchEffect({
      onFailure: (): Effect.Effect<void> =>
        Effect.sync(() => {
          setErrorMessage('Could not archive the topic.');
          setConfirmingArchive(false);
        }),
      onSuccess: (): Effect.Effect<void> =>
        Effect.sync(() => setConfirmingArchive(false)).pipe(Effect.andThen(closeTopicScreen)),
    }),
  );

  const flipVisibilityEffect = (): Effect.Effect<void, ApiFailure> => {
    const toPublic = topic.visibility === 'private';
    return storeCall(() =>
      storeApi.getState().patchTopic(chat.id, {
        visibility: toPublic ? 'public' : 'private',
        ...(toPublic ? { confirmExposeHistory: true } : { memberIds: [me] }),
      }),
    ).pipe(
      Effect.matchEffect({
        onFailure: (): Effect.Effect<void> =>
          Effect.sync(() => {
            setErrorMessage(
              toPublic ? 'Could not make the topic public.' : 'Could not make the topic private.',
            );
            setConfirmingVisibility(false);
          }),
        onSuccess: (): Effect.Effect<void> =>
          Effect.sync(() => setConfirmingVisibility(false)).pipe(
            Effect.andThen(members.reloadAfter()),
          ),
      }),
    );
  };

  // The panel-level buttons each own their call; the confirm dialogs stay here.
  const [leaveState, runLeave] = useAction<void, void, never>(() =>
    clearError.pipe(
      Effect.andThen(leaveEffect),
      Effect.catchTag('ApiFailure', failInline(setErrorMessage, 'Could not leave the topic.')),
    ),
  );
  const [archiveState, runArchive] = useAction<void, void, never>(() =>
    clearError.pipe(Effect.andThen(archiveEffect)),
  );
  const [visibilityState, runVisibility] = useAction<void, void, never>(() =>
    clearError.pipe(
      Effect.andThen(flipVisibilityEffect()),
      Effect.catchTag(
        'ApiFailure',
        failInline(setErrorMessage, 'Could not change the visibility.'),
      ),
    ),
  );

  return {
    storeApi,
    info,
    me,
    groupTitle,
    isManager,
    membersState: {
      status: members.state.status,
      members: members.state.items,
      message: members.state.message,
    },
    refreshMembers: members.refresh,
    aisState: {
      status: ais.state.status,
      ais: ais.state.items,
      message: ais.state.message,
    },
    refreshAis: ais.refresh,
    toolsCount,
    myAis,
    memberPickerOpen,
    setMemberPickerOpen,
    aiPickerOpen,
    setAiPickerOpen,
    confirmingVisibility,
    setConfirmingVisibility,
    confirmingArchive,
    setConfirmingArchive,
    errorMessage,
    setErrorMessage,
    memoryAi,
    setMemoryAi,
    removeMember,
    addMember,
    removeAi,
    addAi,
    leaveState,
    runLeave,
    archiveState,
    runArchive,
    visibilityState,
    runVisibility,
  };
}
