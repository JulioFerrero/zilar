import { formatFileSize, formatTime } from '@zilar/chat-core';
import { Download, RefreshCw, Smartphone } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { IconTile } from '@/components/ui/icon-tile';
import { Text } from '@/components/ui/text';
import { progressLine } from '@/components/update/update-dialog';
import { ACCENT, ACCENT_FOREGROUND, ICON } from '@/lib/colors';
import { useAppUpdate } from '@/lib/use-app-update';

function PhoneTile() {
  return (
    <IconTile>
      <Smartphone size={18} color={ICON} />
    </IconTile>
  );
}

function DownloadTile() {
  return (
    <IconTile>
      <Download size={18} color={ICON} />
    </IconTile>
  );
}

function RowShell({
  leading,
  title,
  subtitle,
  trailing,
}: {
  leading: ReactNode;
  title: ReactNode;
  subtitle: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <View className="flex-row items-center gap-3 px-3 py-2.5">
      {leading}
      <View className="min-w-0 flex-1">
        {title}
        {subtitle}
      </View>
      {trailing}
    </View>
  );
}

function VersionTitle({
  lead,
  version,
  tail,
}: {
  lead: string;
  version: string | null;
  tail?: string;
}) {
  return (
    <Text numberOfLines={1} className="text-[15px] font-medium text-foreground">
      {lead}
      {version === null ? null : ' '}
      {version === null ? null : <Text className="font-mono text-[14px]">{version}</Text>}
      {tail === undefined ? null : ` ${tail}`}
    </Text>
  );
}

function ReadyTitle({ version }: { version: string }) {
  return (
    <View className="flex-row items-center gap-2">
      <View className="h-2 w-2 rounded-full bg-foreground" />
      <Text numberOfLines={1} className="text-[15px] font-medium text-foreground">
        {'Zilar '}
        <Text className="font-mono text-[14px]">{version}</Text>
        {' is ready'}
      </Text>
    </View>
  );
}

function Subtitle({ children }: { children: ReactNode }) {
  return (
    <Text numberOfLines={1} className="mt-0.5 text-[13px] text-muted-foreground">
      {children}
    </Text>
  );
}

function InstalledLine({
  installed,
  sizeBytes,
}: {
  installed: string | null;
  sizeBytes: number | null;
}) {
  return (
    <Subtitle>
      {installed === null ? null : <Text className="font-mono">{installed}</Text>}
      {installed === null ? null : ' installed'}
      {sizeBytes === null ? null : ` · ${formatFileSize(sizeBytes)}`}
    </Subtitle>
  );
}

function checkedLabel(lastCheckedAt: string | null): string {
  if (lastCheckedAt === null) {
    return 'Not checked yet';
  }
  const at = new Date(lastCheckedAt);
  return Number.isNaN(at.getTime()) ? 'Up to date' : `Up to date · checked ${formatTime(at)}`;
}

export function AppVersionRow() {
  const update = useAppUpdate();

  if (Platform.OS !== 'android') {
    return null;
  }
  const { state, installed, enabled, checkNow, download, install } = update;
  const checkButton = (
    <IconButton label="Check for updates" onPress={checkNow}>
      <RefreshCw size={18} color={ICON} />
    </IconButton>
  );
  const checking = (
    <View className="h-10 w-10 items-center justify-center">
      <ActivityIndicator size="small" color={ACCENT} />
    </View>
  );

  if (!enabled) {
    return (
      <RowShell
        leading={<PhoneTile />}
        title={<VersionTitle lead="Zilar" version={installed} />}
        subtitle={<Subtitle>Local build</Subtitle>}
      />
    );
  }

  if (state.status === 'checking') {
    return (
      <RowShell
        leading={<PhoneTile />}
        title={<VersionTitle lead="Zilar" version={installed} />}
        subtitle={<Subtitle>Checking…</Subtitle>}
        trailing={checking}
      />
    );
  }

  if (state.status === 'available') {
    return (
      <RowShell
        leading={<DownloadTile />}
        title={<VersionTitle lead="Zilar" version={state.version} tail="is available" />}
        subtitle={<InstalledLine installed={installed} sizeBytes={state.sizeBytes} />}
        trailing={
          <Button size="sm" onPress={download}>
            <Text>Download</Text>
          </Button>
        }
      />
    );
  }

  if (state.status === 'downloading') {
    return (
      <RowShell
        leading={<DownloadTile />}
        title={<VersionTitle lead="Downloading" version={state.version} />}
        subtitle={<Subtitle>{progressLine(state.progress, state.sizeBytes)}</Subtitle>}
      />
    );
  }

  if (state.status === 'ready' || state.status === 'installing') {
    return (
      <RowShell
        leading={<DownloadTile />}
        title={<ReadyTitle version={state.version} />}
        subtitle={<InstalledLine installed={installed} sizeBytes={state.sizeBytes} />}
        trailing={
          state.status === 'installing' ? (
            <Button size="sm" disabled accessibilityLabel="Installing">
              <ActivityIndicator size="small" color={ACCENT_FOREGROUND} />
            </Button>
          ) : (
            <Button size="sm" onPress={install}>
              <Text>Install</Text>
            </Button>
          )
        }
      />
    );
  }

  if (state.status === 'failed') {
    return (
      <RowShell
        leading={<PhoneTile />}
        title={<VersionTitle lead="Zilar" version={installed} />}
        subtitle={<Subtitle>{state.message}</Subtitle>}
        trailing={checkButton}
      />
    );
  }

  return (
    <RowShell
      leading={<PhoneTile />}
      title={<VersionTitle lead="Zilar" version={installed} />}
      subtitle={<Subtitle>{checkedLabel(state.lastCheckedAt)}</Subtitle>}
      trailing={checkButton}
    />
  );
}
