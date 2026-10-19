import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { RequireAuth } from '@/auth/RequireAuth';
import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { Text, TextField } from '@/components/ui/text';

import { AvatarControl } from '@/components/settings/avatar-control';
import { SettingsScreenShell } from '@/components/settings/screen-shell';
import { LOAD_ERROR, useProfileSettings } from '@/components/settings/use-profile-settings';
import {
  handleAvailabilityText,
  type HandleAvailability,
} from '../../components/settings/profile-logic';

type HandleFieldProps = {
  value: string;
  availability: HandleAvailability;
  error?: string | undefined;
  busy: boolean;
  onChange: (value: string) => void;
};

function HandleField({ value, availability, error, busy, onChange }: HandleFieldProps) {
  const line = handleAvailabilityText(availability);
  const unavailable = availability.state === 'unavailable';
  return (
    <View className="gap-2 rounded-xl border border-border bg-surface px-3 py-2.5">
      <Text className="text-[14px] font-medium text-foreground">Your @username</Text>
      <TextField
        accessibilityLabel="Your username"
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        maxLength={32}
        editable={!busy}
        value={value}
        onChangeText={onChange}
        placeholder="ada_lovelace"
        className="mt-1"
      />
      <View accessibilityLiveRegion="polite" className="min-h-[20px]">
        {line !== null ? (
          <Text
            className={
              unavailable ? 'text-[14px] text-danger' : 'text-[14px] text-muted-foreground'
            }
          >
            {line}
          </Text>
        ) : null}
      </View>
      {error !== undefined ? (
        <Text accessibilityRole="alert" className="text-[14px] text-danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

type BioFieldProps = {
  value: string;
  error?: string | undefined;
  busy: boolean;
  onChange: (value: string) => void;
};

function BioField({ value, error, busy, onChange }: BioFieldProps) {
  return (
    <View className="gap-2 rounded-xl border border-border bg-surface px-3 py-2.5">
      <Text className="text-[16px] font-semibold text-foreground">Bio</Text>
      <TextField
        accessibilityLabel="Bio"
        maxLength={140}
        editable={!busy}
        value={value}
        onChangeText={(next) => onChange(next.replace(/[\r\n]+/g, ''))}
        placeholder="A few words about you"
        className="mt-1"
      />
      <View className="flex-row items-start justify-between gap-2">
        <Text className="flex-1 text-[13px] text-muted-foreground">
          A few words about you. Anyone who finds you by username can see it.
        </Text>
        <Text className="shrink-0 text-[13px] tabular-nums text-muted-foreground">
          {value.length} / 140
        </Text>
      </View>
      {error !== undefined ? (
        <Text accessibilityRole="alert" className="text-[14px] text-danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

type NameFieldProps = BioFieldProps;

function NameField({ value, error, busy, onChange }: NameFieldProps) {
  return (
    <View className="gap-2 rounded-xl border border-border bg-surface px-3 py-2.5">
      <Text className="text-[16px] font-semibold text-foreground">Display name</Text>
      <TextField
        accessibilityLabel="Display name"
        maxLength={64}
        editable={!busy}
        value={value}
        onChangeText={onChange}
        placeholder="Your name"
        className="mt-1"
      />
      {error !== undefined ? (
        <Text accessibilityRole="alert" className="text-[14px] text-danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

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
