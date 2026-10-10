import { Effect } from 'effect';
import { useState } from 'react';

import { groupAction, rawCall } from '@/components/chat/group-action';
import { visibilitySaveError } from '@/components/chat/visibility-sheet';
import { useDirectoryApi } from '@/components/directory/use-directory-api';
import { DirectoryApiError, type GroupVisibility } from '@/lib/directory-api';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { useChatStore } from '@/store/chat-store-provider';

/**
 * The group screen's visibility sheet state (T-0183). Owner only, like the web
 * panel: it reads server truth on open, keeps a debounced live availability
 * check for a changed handle, and saves through the directory API. The store
 * refreshes the detail so the header re-renders with server truth.
 */
export function useGroupVisibility(groupId: string) {
  const { api: directoryApi } = useDirectoryApi();
  const refreshGroupDetail = useChatStore((state) => state.refreshGroupDetail);

  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const [visibilityTruth, setVisibilityTruth] = useState<{
    visibility: GroupVisibility;
    handle: string | null;
  } | null>(null);
  const [visibilityLoadError, setVisibilityLoadError] = useState('');
  const [picked, setPicked] = useState<GroupVisibility>('private');
  const [typed, setTyped] = useState('');
  const [check, setCheck] = useState<{ available: boolean; reason?: string | undefined } | null>(
    null,
  );
  const [checking, setChecking] = useState(false);
  const [visibilityError, setVisibilityError] = useState('');
  const [visibilitySaved, setVisibilitySaved] = useState(false);
  const [confirmingPrivate, setConfirmingPrivate] = useState(false);

  const [, loadVisibility] = useAction((visibilityGroupId: string) =>
    groupAction(
      rawCall(() => directoryApi.getGroupVisibility(visibilityGroupId)).pipe(
        Effect.tap((truth) =>
          Effect.sync(() => {
            setVisibilityTruth(truth);
            setPicked(truth.visibility);
            setTyped(truth.handle ?? '');
          }),
        ),
      ),
      () => setVisibilityLoadError('Could not load visibility. Try again.'),
    ),
  );

  const open = () => {
    setVisibilityError('');
    setVisibilitySaved(false);
    setConfirmingPrivate(false);
    setCheck(null);
    setVisibilityOpen(true);
    setVisibilityLoadError('');
    loadVisibility(groupId);
  };

  const trimmedHandle = typed.trim();
  const ownHandle =
    visibilityTruth?.handle !== null &&
    visibilityTruth?.handle !== undefined &&
    visibilityTruth.handle !== '' &&
    trimmedHandle.toLowerCase() === visibilityTruth.handle.toLowerCase();

  // Debounced live availability for a changed handle (the group's own
  // handle is skipped: the server sees its live row and would report
  // "taken"). The query is the timer: a deps change or unmount interrupts a
  // check still waiting, which replaces the old cleanup.
  const checkHandle = (value: string) =>
    Effect.sleep(300).pipe(
      Effect.andThen(
        Effect.sync(() => {
          setChecking(true);
        }),
      ),
      Effect.andThen(
        rawCall(() => directoryApi.checkGroupHandle(value)).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              setCheck(result);
              setChecking(false);
            }),
          ),
          Effect.catch(({ cause }) =>
            Effect.sync(() => {
              if (cause instanceof DirectoryApiError && cause.code === 'rate_limited') {
                setCheck({ available: false, reason: 'rate_limited' });
              } else {
                setCheck(null);
              }
              setChecking(false);
            }),
          ),
        ),
      ),
    );
  const wantsCheck = visibilityOpen && picked === 'public' && trimmedHandle !== '' && !ownHandle;
  useQuery(
    () => (wantsCheck ? checkHandle(trimmedHandle) : Effect.void),
    [visibilityOpen, picked, trimmedHandle, ownHandle, directoryApi],
  );

  const [visibilitySave, runVisibilitySave] = useAction(
    (input: { readonly visibility: GroupVisibility; readonly handle: string }) =>
      groupAction(
        rawCall(() =>
          directoryApi.setGroupVisibility(
            groupId,
            input.visibility === 'public'
              ? { visibility: input.visibility, handle: input.handle }
              : { visibility: input.visibility },
          ),
        ).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              setVisibilityTruth({
                visibility: input.visibility,
                handle: input.visibility === 'public' ? input.handle : null,
              });
              setVisibilitySaved(true);
              setConfirmingPrivate(false);
              refreshGroupDetail(groupId);
            }),
          ),
        ),
        (cause) => setVisibilityError(visibilitySaveError(cause)),
      ),
  );
  const visibilityBusy = isWaiting(visibilitySave);
  const busy = visibilityBusy || visibilityTruth === null;

  const save = () => {
    if (visibilityTruth === null) {
      return;
    }
    if (picked === 'public' && trimmedHandle === '') {
      setVisibilityError('Choose a handle for the public group.');
      return;
    }
    if (picked === 'private' && visibilityTruth.visibility === 'public' && !confirmingPrivate) {
      setConfirmingPrivate(true);
      return;
    }
    setVisibilityError('');
    setVisibilitySaved(false);
    runVisibilitySave({ visibility: picked, handle: trimmedHandle });
  };

  return {
    visible: visibilityOpen,
    open,
    close: () => {
      if (!visibilityBusy) {
        setVisibilityOpen(false);
      }
    },
    truth: visibilityTruth,
    picked,
    typed,
    busy,
    checking,
    check,
    error: visibilityLoadError !== '' ? visibilityLoadError : visibilityError,
    saved: visibilitySaved,
    confirmingPrivate,
    pick: (next: GroupVisibility) => {
      setPicked(next);
      setCheck(null);
      setVisibilityError('');
      setVisibilitySaved(false);
      setConfirmingPrivate(false);
    },
    changeHandle: (next: string) => {
      setTyped(next);
      setCheck(null);
      setVisibilitySaved(false);
    },
    save,
    cancelPrivate: () => setConfirmingPrivate(false),
  };
}
