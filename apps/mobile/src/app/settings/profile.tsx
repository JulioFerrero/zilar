import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { RequireAuth } from '@/auth/RequireAuth';
import { StateMessage } from '@/components/ui/state-message';

import { AvatarControl } from '@/components/settings/avatar-control';
import { BioField } from '@/components/settings/bio-field';
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
    bio,
    bioError,
    bioSaved,
    bioBusy,
    bioUnchanged,
    onBioChange,
    saveBio,
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
  // A name Save must wait while a bio save is in flight: the bio PATCH carries
  // the saved name, so its reply could land last and revert a rename (S2, the
  // mirror of the bio guard). `unchanged` is NameField's Save-disabled prop.
  const nameSaveBlocked = nameUnchanged || bioBusy;

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
            unchanged={nameSaveBlocked}
            onChange={onNameChange}
            onSave={saveName}
          />

          <BioField
            value={bio}
            error={bioError}
            saved={bioSaved}
            busy={bioBusy}
            unchanged={bioUnchanged}
            saveDisabled={nameBusy}
            onChange={onBioChange}
            onSave={saveBio}
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
