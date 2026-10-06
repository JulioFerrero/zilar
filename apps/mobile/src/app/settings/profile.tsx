import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { RequireAuth } from '@/auth/RequireAuth';
import { useAuthStore } from '@/auth/session';
import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { getSessionToken } from '@/lib/session-token';
import { ProfileApiError, type MyProfile } from '@/lib/profile-api';

import { AvatarControl } from '@/components/settings/avatar-control';
import { createAvatarFileUploader, createPicturePicker } from '@/components/settings/avatar-native';
import { HandleField } from '@/components/settings/handle-field';
import {
  friendlyAvatarError,
  friendlyClaimError,
  handleAvailabilityFor,
  isHandleRateLimited,
  type AvatarPhase,
  type HandleAvailability,
} from '@/components/settings/profile-logic';
import { SettingsScreenShell } from '@/components/settings/screen-shell';
import { useProfileApi } from '@/components/settings/use-profile-api';

type ProfileStatus = 'loading' | 'ready' | 'error';

const HANDLE_CHECK_DEBOUNCE_MS = 300;

export default function ProfileSettingsScreen() {
  return (
    <RequireAuth>
      <ProfileSettings />
    </RequireAuth>
  );
}

function ProfileSettings() {
  const router = useRouter();
  const { api } = useProfileApi();
  const setName = useAuthStore((state) => state.setName);

  const [status, setStatus] = useState<ProfileStatus>('loading');
  const [profile, setProfile] = useState<MyProfile | null>(null);

  const [name, setNameInput] = useState('');
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [nameSaved, setNameSaved] = useState(false);
  const [nameBusy, setNameBusy] = useState(false);
  const nameRef = useRef(false);

  const [handle, setHandle] = useState('');
  const [availability, setAvailability] = useState<HandleAvailability>({ state: 'idle' });
  const [handleError, setHandleError] = useState<string | undefined>(undefined);
  const [handleSaved, setHandleSaved] = useState(false);
  const [handleBusy, setHandleBusy] = useState(false);
  const handleRef = useRef(false);

  const [avatarToken, setAvatarToken] = useState<string | undefined>(undefined);
  const [avatarPhase, setAvatarPhase] = useState<AvatarPhase>({ name: 'idle' });
  const [avatarBusy, setAvatarBusy] = useState(false);
  const avatarRef = useRef(false);

  // Loads the profile (and the avatar bearer) into every section. Like the
  // AI list's `reload`, it paints `loading` first; the focus effect below
  // calls it, so returning to the screen always shows server truth.
  const load = useCallback(() => {
    setStatus('loading');
    void Promise.all([api.getMe(), getSessionToken()])
      .then(([me, token]) => {
        setProfile(me);
        setNameInput(me.name);
        setNameError(undefined);
        setNameSaved(false);
        setHandle(me.handle ?? '');
        setAvailability({ state: 'idle' });
        setHandleError(undefined);
        setHandleSaved(false);
        setAvatarPhase({ name: 'idle' });
        setAvatarToken(token);
        setStatus('ready');
      })
      .catch(() => {
        setStatus('error');
      });
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const reload = load;

  // Debounced live availability for a changed handle. The effect only
  // schedules the check; the timeout callback applies the result once. Your
  // own handle (any casing) skips the check: the server sees its live row
  // and would report "taken", which is misleading next to an enabled Save.
  const trimmed = handle.trim();
  const current = profile?.handle ?? '';
  const ownHandle = current !== '' && trimmed.toLowerCase() === current.toLowerCase();
  useEffect(() => {
    if (trimmed === '' || ownHandle) {
      return;
    }
    let active = true;
    const value = trimmed;
    const pending = setTimeout(() => {
      setAvailability({ state: 'checking' });
      void api.checkHandle(value).then(
        (result) => {
          if (active) {
            setAvailability(
              handleAvailabilityFor(value, {
                ok: true,
                available: result.available,
                reason: result.reason,
              }),
            );
          }
        },
        (checkError: unknown) => {
          if (!active) return;
          if (isHandleRateLimited(checkError)) {
            setAvailability(handleAvailabilityFor(value, { ok: false, rateLimited: true }));
            return;
          }
          setAvailability(handleAvailabilityFor(value, { ok: false, rateLimited: false }));
        },
      );
    }, HANDLE_CHECK_DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(pending);
    };
  }, [api, trimmed, ownHandle]);

  const saveName = (): void => {
    if (nameRef.current) return;
    const value = name.trim();
    if (value.length === 0) {
      setNameError('Enter your name');
      return;
    }
    nameRef.current = true;
    setNameBusy(true);
    setNameError(undefined);
    setNameSaved(false);
    void setName(value)
      .then((result) => {
        if (!result.ok) {
          setNameError('Could not save your name. Try again.');
          return;
        }
        setProfile((previous) => (previous === null ? previous : { ...previous, name: value }));
        setNameSaved(true);
      })
      .catch(() => setNameError('Could not save your name. Try again.'))
      .finally(() => {
        nameRef.current = false;
        setNameBusy(false);
      });
  };

  const saveHandle = (): void => {
    if (handleRef.current) return;
    if (trimmed === '') {
      setHandleError('Choose a username');
      return;
    }
    handleRef.current = true;
    setHandleBusy(true);
    setHandleError(undefined);
    setHandleSaved(false);
    void api
      .claimHandle(trimmed)
      .then((claimed) => {
        setProfile((previous) =>
          previous === null ? previous : { ...previous, handle: claimed.handle },
        );
        setHandle(claimed.handle);
        setAvailability({ state: 'idle' });
        setHandleSaved(true);
      })
      .catch((error: unknown) => setHandleError(friendlyClaimError(error)))
      .finally(() => {
        handleRef.current = false;
        setHandleBusy(false);
      });
  };

  const pickPicture = (): void => {
    if (avatarRef.current) return;
    avatarRef.current = true;
    setAvatarBusy(true);
    void createPicturePicker()
      .pickPicture()
      .then((result) => {
        if (result.status === 'picked') {
          setAvatarPhase({
            name: 'picked',
            uri: result.picture.uri,
            mimeType: result.picture.mimeType,
          });
        } else if (result.status === 'error') {
          setAvatarPhase({ name: 'failed', message: result.message });
        }
      })
      .catch(() =>
        setAvatarPhase({ name: 'failed', message: 'Could not pick that picture. Try again.' }),
      )
      .finally(() => {
        avatarRef.current = false;
        setAvatarBusy(false);
      });
  };

  const savePickedPicture = (): void => {
    if (avatarRef.current || profile === null) return;
    if (avatarPhase.name !== 'picked') return;
    const picked = avatarPhase;
    avatarRef.current = true;
    setAvatarBusy(true);
    setAvatarPhase({
      name: 'uploading',
      uri: picked.uri,
      mimeType: picked.mimeType,
      progress: 0,
    });
    // The settings API uploads a local file through `expo-file-system` (React
    // Native's `fetch` cannot send binary bodies); the uploader reports
    // progress back into the phase. In mock mode the mock answers without
    // touching the file.
    const uploader = async (url: string): Promise<unknown> => {
      const token = avatarToken ?? (await getSessionToken());
      if (token === undefined) {
        throw new ProfileApiError(401, 'unauthorized', 'No session');
      }
      return createAvatarFileUploader().upload(
        url,
        { uri: picked.uri, mimeType: picked.mimeType, width: 0, height: 0 },
        token,
        (fraction) => {
          setAvatarPhase({
            name: 'uploading',
            uri: picked.uri,
            mimeType: picked.mimeType,
            progress: fraction,
          });
        },
      );
    };
    void api
      .uploadAvatar(profile.id, new Blob([], { type: picked.mimeType }), uploader)
      .then((result) => {
        setProfile((previous) =>
          previous === null ? previous : { ...previous, avatarUrl: result.url },
        );
        setAvatarPhase({ name: 'idle' });
      })
      .catch((error: unknown) => {
        setAvatarPhase({ name: 'failed', message: friendlyAvatarError(error) });
      })
      .finally(() => {
        avatarRef.current = false;
        setAvatarBusy(false);
      });
  };

  const removePicture = (): void => {
    if (avatarRef.current || profile === null) return;
    avatarRef.current = true;
    setAvatarBusy(true);
    void api
      .removeAvatar(profile.id)
      .then(() => {
        setProfile((previous) =>
          previous === null ? previous : { ...previous, avatarUrl: undefined },
        );
        setAvatarPhase({ name: 'removed' });
      })
      .catch((error: unknown) => {
        setAvatarPhase({ name: 'failed', message: friendlyAvatarError(error) });
      })
      .finally(() => {
        avatarRef.current = false;
        setAvatarBusy(false);
      });
  };

  // Save is disabled only for the exactly equal value; a casing-only change
  // stays enabled — the server applies it (interval rule, casing updated,
  // nothing retired).
  const unchanged = trimmed !== '' && trimmed === current;
  const nameUnchanged = name.trim() !== '' && name.trim() === (profile?.name ?? '');

  return (
    <SettingsScreenShell
      title="Profile"
      subtitle="Your picture and username, seen by your contacts."
      onBack={() => router.back()}
    >
      {status === 'loading' ? <StateMessage kind="loading" title="Loading…" /> : null}

      {status === 'error' ? (
        <StateMessage
          kind="error"
          title="Could not load your profile."
          action={{ label: 'Retry', onPress: reload }}
        />
      ) : null}

      {status === 'ready' && profile !== null ? (
        <View className="gap-3">
          <AvatarControl
            ownerId={profile.id}
            ownerName={profile.name}
            currentUrl={profile.avatarUrl}
            token={avatarToken}
            phase={avatarPhase}
            busy={avatarBusy}
            onPick={pickPicture}
            onSavePicked={savePickedPicture}
            onRemove={removePicture}
          />

          <View className="gap-2 rounded-xl border border-border bg-surface px-3 py-2.5">
            <Text className="text-[16px] font-semibold text-foreground">Display name</Text>
            <TextField
              accessibilityLabel="Display name"
              maxLength={64}
              editable={!nameBusy}
              value={name}
              onChangeText={(value) => {
                setNameInput(value);
                setNameSaved(false);
              }}
              placeholder="Your name"
              className="mt-1"
            />
            {nameError !== undefined ? (
              <Text accessibilityRole="alert" className="text-[14px] text-danger">
                {nameError}
              </Text>
            ) : null}
            {nameSaved ? <Text className="text-[14px] text-muted-foreground">Saved.</Text> : null}
            <Button
              variant="default"
              size="sm"
              className="mt-1 self-start"
              accessibilityLabel="Save name"
              disabled={nameBusy || nameUnchanged}
              onPress={saveName}
            >
              <Text>{nameBusy ? 'Saving…' : 'Save name'}</Text>
            </Button>
          </View>

          <HandleField
            value={handle}
            current={current}
            availability={availability}
            error={handleError}
            saved={handleSaved}
            busy={handleBusy}
            saveDisabled={unchanged}
            onChange={(value) => {
              setHandle(value);
              setHandleSaved(false);
            }}
            onSave={saveHandle}
          />
        </View>
      ) : null}
    </SettingsScreenShell>
  );
}
