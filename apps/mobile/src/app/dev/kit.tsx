/**
 * Hidden mobile kit catalog (T-0264): reachable only by the `zilar://dev/kit`
 * URL, linked from nowhere. It renders every `components/ui` kit component with
 * sample content so the kit can be eyeballed on-device. It stays unlinked in
 * release builds too: no tab, no button, no router push.
 */
import { Bell, FolderOpen, MessageCircle, Trash2, UserRound } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';
import { Button } from '@/components/ui/button';
import { Card, SectionLabel } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CountBadge } from '@/components/ui/count-badge';
import { IconButton } from '@/components/ui/icon-button';
import { IconTile } from '@/components/ui/icon-tile';
import { ListRow } from '@/components/ui/list-row';
import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { ICON } from '@/lib/colors';

const noop = (): void => undefined;

export default function KitDevScreen() {
  return (
    <RequireAuth>
      <KitCatalog />
    </RequireAuth>
  );
}

function KitCatalog() {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView
        className="flex-1 px-5 pt-6"
        contentContainerStyle={{ paddingBottom: 48 }}
        testID="kit-dev-screen"
      >
        <Text variant="h3">Mobile kit catalog</Text>
        <Text className="mt-1 text-[13px] text-muted-foreground">
          Every components/ui component with sample content.
        </Text>

        <View className="mt-6 gap-2">
          <SectionLabel>Buttons</SectionLabel>
          <View className="gap-3">
            <Button onPress={noop}>
              <Text>Default</Text>
            </Button>
            <Button variant="secondary" onPress={noop}>
              <Text>Secondary</Text>
            </Button>
            <Button variant="outline" onPress={noop}>
              <Text>Outline</Text>
            </Button>
            <Button variant="ghost" onPress={noop}>
              <Text>Ghost</Text>
            </Button>
            <Button variant="destructive" onPress={noop}>
              <Text>Destructive</Text>
            </Button>
            <Button variant="link" onPress={noop}>
              <Text>Link</Text>
            </Button>
          </View>
        </View>

        <View className="mt-6 gap-2">
          <SectionLabel>Icon button and tile</SectionLabel>
          <View className="flex-row items-center gap-3">
            <IconButton label="Notifications" onPress={noop}>
              <Bell size={18} color={ICON[scheme]} />
            </IconButton>
            <IconTile>
              <UserRound size={18} color={ICON[scheme]} />
            </IconTile>
            <IconTile size={36} radius={12}>
              <FolderOpen size={18} color={ICON[scheme]} />
            </IconTile>
          </View>
        </View>

        <View className="mt-6 gap-2">
          <SectionLabel>Count badge</SectionLabel>
          <View className="flex-row items-center gap-3">
            <CountBadge count={1} />
            <CountBadge count={12} />
            <CountBadge count={0} />
          </View>
        </View>

        <View className="mt-6 gap-2">
          <SectionLabel>List rows</SectionLabel>
          <Card>
            <ListRow
              icon={
                <IconTile>
                  <Bell size={18} color={ICON[scheme]} />
                </IconTile>
              }
              title="Notifications"
              subtitle="Sounds and vibrations"
              onPress={noop}
            />
            <ListRow
              icon={
                <IconTile>
                  <UserRound size={18} color={ICON[scheme]} />
                </IconTile>
              }
              title="Requests"
              subtitle="Incoming and outgoing"
              count={3}
              onPress={noop}
            />
            <ListRow title="A row without a chevron" subtitle="No action" chevron={false} />
            <ListRow title="A row that does not act" subtitle="Renders a View" />
          </Card>
        </View>

        <View className="mt-6 gap-2">
          <SectionLabel>Action sheet</SectionLabel>
          <Button onPress={() => setSheetOpen(true)}>
            <Text>Open action sheet</Text>
          </Button>
          <ActionSheet
            visible={sheetOpen}
            onClose={() => setSheetOpen(false)}
            closeLabel="Close sample actions"
            title="Sample actions"
            error="Something went wrong."
          >
            <ActionSheetItem
              label="Open chat"
              icon={MessageCircle}
              onPress={() => setSheetOpen(false)}
            />
            <ActionSheetItem
              label="Delete"
              icon={Trash2}
              destructive
              onPress={() => setSheetOpen(false)}
            />
            <ActionSheetItem label="A disabled action" disabled onPress={noop} />
          </ActionSheet>
        </View>

        <View className="mt-6 gap-2">
          <SectionLabel>Confirm dialog</SectionLabel>
          <Button onPress={() => setConfirmOpen(true)}>
            <Text>Open confirm dialog</Text>
          </Button>
          <ConfirmDialog
            visible={confirmOpen}
            title="Delete this item?"
            message="This removes the item for good. This cannot be undone."
            error="Something went wrong."
            confirmLabel="Delete"
            busyLabel="Working…"
            busy={false}
            onCancel={() => setConfirmOpen(false)}
            onConfirm={() => setConfirmOpen(false)}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
