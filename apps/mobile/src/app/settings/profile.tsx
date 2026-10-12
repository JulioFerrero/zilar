import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { RequireAuth } from '@/auth/RequireAuth';
import { StateMessage } from '@/components/ui/state-message';

import { AvatarControl } from '@/components/settings/avatar-control';
import { HandleField } from '@/components/settings/handle-field';
import { NameField } from '@/components/settings/name-field';
import { SettingsScreenShell } from '@/components/settings/screen-shell';
import { LOAD_ERROR, useProfileSettings } from '@/components/settings/use-profile-settings';
import { useChatStore } from '@/store/chat-store-provider';

export default function ProfileSettingsScreen() {
  return (
    <RequireAuth>
      <ProfileSettings />
    </RequireAuth>
  );
}

function ProfileSettings() {
  const router = useRouter();
  const {
    status,
    profile,
    reload,
    avatarToken,
    avatarPhase,
    avatarBusy,
    pickPicture,
    savePickedPicture,
    removePicture,
    name,
    nameError,
    nameSaved,
    nameBusy,
    nameUnchanged,
    onNameChange,
    saveName,
    handle,
    currentHandle,
    availability,
    handleError,
    handleSaved,
    handleBusy,
    handleSaveDisabled,
    onHandleChange,
    saveHandle,
  } = useProfileSettings();
  // T-1212: the ball is seeded by the own bare JID (the same ball as the
  // chat list and the profile screen).
  const ownJid = useChatStore((state) => state.me?.jid ?? undefined);

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
          title={LOAD_ERROR}
          action={{ label: 'Retry', onPress: reload }}
        />
      ) : null}

      {status === 'ready' && profile !== null ? (
        <View className="gap-3">
          <AvatarControl
            ownerId={profile.id}
            ownerName={profile.name}
            ownerSeed={ownJid}
            currentUrl={profile.avatarUrl}
            token={avatarToken}
            phase={avatarPhase}
            busy={avatarBusy}
            onPick={pickPicture}
            onSavePicked={() => savePickedPicture(profile.id)}
            onRemove={() => removePicture(profile.id)}
          />

          <NameField
            value={name}
            error={nameError}
            saved={nameSaved}
            busy={nameBusy}
            unchanged={nameUnchanged}
            onChange={onNameChange}
            onSave={saveName}
          />

          <HandleField
            value={handle}
            current={currentHandle}
            availability={availability}
            error={handleError}
            saved={handleSaved}
            busy={handleBusy}
            saveDisabled={handleSaveDisabled}
            onChange={onHandleChange}
            onSave={saveHandle}
          />
        </View>
      ) : null}
    </SettingsScreenShell>
  );
}
