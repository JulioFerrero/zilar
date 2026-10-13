import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { RequireAuth } from '@/auth/RequireAuth';
import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';

import { AvatarControl } from '@/components/settings/avatar-control';
import { BioField } from '@/components/settings/bio-field';
import { HandleField } from '@/components/settings/handle-field';
import { NameField } from '@/components/settings/name-field';
import { SettingsScreenShell } from '@/components/settings/screen-shell';
import { LOAD_ERROR, useProfileSettings } from '@/components/settings/use-profile-settings';

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
    onNameChange,
    bio,
    bioError,
    onBioChange,
    handle,
    availability,
    handleError,
    onHandleChange,
    changed,
    saved,
    saveBusy,
    saveAll,
  } = useProfileSettings();
  const ready = status === 'ready' && profile !== null;

  return (
    <SettingsScreenShell
      title="Profile"
      subtitle="Your picture and username, seen by your contacts."
      onBack={() => router.back()}
      // T-1329: one Save for name, username and bio, like web and Telegram.
      right={
        ready ? (
          <Button
            size="sm"
            disabled={!changed || saveBusy}
            onPress={saveAll}
            accessibilityLabel="Save profile"
          >
            <Text>{saveBusy ? 'Saving…' : 'Save'}</Text>
          </Button>
        ) : undefined
      }
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
            currentUrl={profile.avatarUrl}
            token={avatarToken}
            phase={avatarPhase}
            busy={avatarBusy}
            onPick={pickPicture}
            onSavePicked={() => savePickedPicture(profile.id)}
            onRemove={() => removePicture(profile.id)}
          />

          <NameField value={name} error={nameError} busy={saveBusy} onChange={onNameChange} />

          <BioField value={bio} error={bioError} busy={saveBusy} onChange={onBioChange} />

          <HandleField
            value={handle}
            availability={availability}
            error={handleError}
            busy={saveBusy}
            onChange={onHandleChange}
          />

          {saved && !saveBusy ? (
            <Text className="text-center text-[14px] text-muted-foreground">Saved.</Text>
          ) : null}
        </View>
      ) : null}
    </SettingsScreenShell>
  );
}
