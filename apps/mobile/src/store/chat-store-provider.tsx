import { useGlobalSearchParams } from 'expo-router';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { useSession } from '@/auth/session';
import { ENV_MOCK, ENV_NODE_ENV, isMockMode, mockToken } from '@/mock/gate';

import { createRealChatStore } from './real-store';
import { type AppStateLike, type RealStoreDeps } from './effects/ports';
import { makeChatApi } from '../lib/chat-api';
import { makeInviteLinksApi } from '../lib/invite-links-api';
import { makeRolesApi } from '../lib/roles-api';
import { makeChatPrefsApi } from '../lib/chat-prefs-api';
import { makeChatFoldersApi } from '../lib/chat-folders-api';
import { apiCall } from '../lib/effect/api-client';
import { ensurePushPair, registerNativePush, watchPushTokenRolls } from '../lib/push/native';
import { createSizeReader } from '../lib/attachment-picker';
import { getSessionToken } from '../lib/session-token';
import { API_URL } from '../lib/auth';
import { clearTranscripts } from '../lib/voice-transcripts';
import type { ChatStoreState } from './types';
import { makeChatExtrasApi, makeGroupsApi, makeTopicsApi, type StoreApi } from '@zilar/client-core';
import { Effect } from 'effect';
import { File, UploadType } from 'expo-file-system';
import type { AttachmentUploader, PickedFile } from '../lib/attachment-ports';

const checkUploadStatus = (result: { readonly status: number }): Effect.Effect<void, Error> =>
  result.status < 200 || result.status >= 300
    ? Effect.fail(new Error(`upload refused: ${result.status}`))
    : Effect.void;

const uploadEffect = (
  file: PickedFile,
  slot: { putUrl: string; headers: Record<string, string> },
  onProgress: ((fraction: number) => void) | undefined,
  current: AbortController,
): Effect.Effect<void, unknown> =>
  Effect.tryPromise({
    try: () =>
      new File(file.uri).upload(slot.putUrl, {
        httpMethod: 'PUT',
        uploadType: UploadType.BINARY_CONTENT,
        headers: { 'content-type': file.mimeType, ...slot.headers },
        mimeType: file.mimeType,
        onProgress:
          onProgress === undefined
            ? undefined
            : (data) => {
                if (data.totalBytes > 0) {
                  onProgress(Math.min(1, Math.max(0, data.bytesSent / data.totalBytes)));
                }
              },
        signal: current.signal,
      }),
    catch: (error: unknown) => error,
  }).pipe(
    Effect.flatMap(checkUploadStatus),
    // A failure after `cancel` reads as cancelled, whatever the native error was.
    Effect.mapError((error: unknown) => (current.signal.aborted ? new Error('cancelled') : error)),
  );

/**
 * One AbortController per message id, so two chats upload independently and cancelling one never touches the other.
 */
function createAttachmentUploader(): AttachmentUploader {
  const controllers = new Map<string, AbortController>();
  return {
    upload(
      file: PickedFile,
      slot: { putUrl: string; headers: Record<string, string> },
      onProgress?: (fraction: number) => void,
      messageId?: string,
    ): Promise<void> {
      const current = new AbortController();
      const key = messageId ?? file.uri;
      controllers.set(key, current);
      return Effect.runPromise(
        uploadEffect(file, slot, onProgress, current).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (controllers.get(key) === current) {
                controllers.delete(key);
              }
            }),
          ),
        ),
      );
    },
    cancel(messageId: string): void {
      controllers.get(messageId)?.abort();
      controllers.delete(messageId);
    },
  };
}

const ChatStoreContext = createContext<StoreApi<ChatStoreState> | null>(null);

const rnAppState: AppStateLike = {
  current: () => AppState.currentState,
  subscribe: (handler) => {
    const subscription = AppState.addEventListener('change', (state) => handler(state));
    return () => subscription.remove();
  },
};

function sharedDeps(): Pick<RealStoreDeps, 'appState' | 'uploader' | 'statSize'> {
  return {
    appState: rnAppState,
    uploader: createAttachmentUploader(),
    // Unknown-size picks are re-statted right before the slot request.
    statSize: (uri) => createSizeReader().sizeOf(uri),
  };
}

/**
 * The mock backend is loaded behind a literal build-time condition, so Metro folds it to `false` in a release build and leaves it out of the bundle.
 */
function mockStoreDeps(): RealStoreDeps | null {
  if (process.env.NODE_ENV === 'test' || __DEV__ || process.env.EXPO_PUBLIC_ZILAR_MOCK) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { backend, mockFetch } = require('../mock/backend') as typeof import('../mock/backend');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createMockUploader } = require('../mock/uploader') as typeof import('../mock/uploader');
    const call = apiCall({ getToken: mockToken, fetchImpl: mockFetch, apiUrl: API_URL });
    return {
      ...sharedDeps(),
      // The fake core's slot URL is a `data:` URL, so the real native PUT cannot work in mock mode: this one reports progress and resolves without network.
      uploader: createMockUploader(),
      api: makeChatApi(call),
      topicsApi: makeTopicsApi(call),
      inviteLinksApi: makeInviteLinksApi(call),
      rolesApi: makeRolesApi(call),
      groupsApi: makeGroupsApi(call),
      chatPrefsApi: makeChatPrefsApi(call),
      chatFoldersApi: makeChatFoldersApi(call),
      pinsApi: makeChatExtrasApi(call),
      mediaApi: makeChatExtrasApi(call),
      createXmpp: backend.xmpp,
    };
  }
  return null;
}

function realStoreDeps(): RealStoreDeps {
  const call = apiCall({ getToken: getSessionToken, fetchImpl: fetch, apiUrl: API_URL });
  return {
    ...sharedDeps(),
    chatPrefsApi: makeChatPrefsApi(call),
    chatFoldersApi: makeChatFoldersApi(call),
    pinsApi: makeChatExtrasApi(call),
  };
}

export function ChatStoreProvider({ children }: { children: ReactNode }) {
  const params = useGlobalSearchParams();
  const { status } = useSession();
  // Pinned at mount, so the mode cannot flip under the store if a later route drops the `?mock` param.
  const [mock] = useState(() =>
    isMockMode(params, { dev: __DEV__, envMock: ENV_MOCK, nodeEnv: ENV_NODE_ENV }),
  );
  const [store] = useState<StoreApi<ChatStoreState>>(() =>
    createRealChatStore((mock ? mockStoreDeps() : null) ?? realStoreDeps()),
  );
  // Mock mode has no session: its status settling to `guest` must not tear the store down and lose the open chat's history.
  const active = mock || status === 'authenticated';

  useEffect(() => {
    if (!active) {
      return;
    }
    store.getState().start();
    return () => store.getState().stop();
  }, [store, active]);

  useEffect(() => {
    if (status === 'guest') {
      void clearTranscripts();
    }
  }, [status]);

  // Reconnects and wakes run a new XMPP session, whose push pair is missing (ejabberd binds the pair to the session that sent `<enable/>`); every later transition into `online` re-sends the saved pair, which also retries a failed first enable.
  useEffect(() => {
    if (!active || mock) {
      return;
    }
    const setPushPair = store.getState().setPushPair;
    let registered = false;
    let online = false;
    const onStatus = () => {
      const nowOnline = store.getState().status === 'online';
      const entered = nowOnline && !online;
      online = nowOnline;
      if (!entered) {
        return;
      }
      if (!registered) {
        registered = true;
        void registerNativePush({ setPushPair });
        return;
      }
      void ensurePushPair({ setPushPair });
    };
    const unsubscribe = store.subscribe(onStatus);
    const tokenRolls = watchPushTokenRolls({ setPushPair });
    onStatus();
    return () => {
      unsubscribe();
      tokenRolls.remove();
    };
  }, [store, active, mock]);

  return <ChatStoreContext.Provider value={store}>{children}</ChatStoreContext.Provider>;
}

export function useChatStore<T>(selector: (state: ChatStoreState) => T): T {
  const store = useContext(ChatStoreContext);
  if (store === null) {
    throw new Error('useChatStore must be used inside ChatStoreProvider');
  }
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getInitialState()),
  );
}

/** The join route resolves the just-joined group after the store refreshes chats, so it must read fresh rather than from its render-time snapshot. */
export function useChatStoreApi(): StoreApi<ChatStoreState> {
  const store = useContext(ChatStoreContext);
  if (store === null) {
    throw new Error('useChatStoreApi must be used inside ChatStoreProvider');
  }
  return store;
}
