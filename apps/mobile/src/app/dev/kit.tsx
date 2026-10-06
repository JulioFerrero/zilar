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
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Card, SectionLabel } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CountBadge } from '@/components/ui/count-badge';
import { IconButton } from '@/components/ui/icon-button';
import { IconTile } from '@/components/ui/icon-tile';
import { ListRow } from '@/components/ui/list-row';
import { SearchField } from '@/components/ui/search-field';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
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
  const [bottomOpen, setBottomOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [search, setSearch] = useState('Try clearing me');
  const [segment, setSegment] = useState('one');
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
          <SectionLabel>Text field</SectionLabel>
          <View className="gap-3">
            <TextField placeholder="A plain field" accessibilityLabel="Plain text field" />
            <TextField
              label="With a label"
              placeholder="A labeled field"
              accessibilityLabel="Labeled text field"
            />
            <TextField
              label="Multiline"
              placeholder="Several lines…"
              accessibilityLabel="Multiline text field"
              multiline
              className="min-h-[100px]"
            />
          </View>
        </View>

        <View className="mt-6 gap-2">
          <SectionLabel>Search field</SectionLabel>
          <View className="gap-3">
            <SearchField placeholder="Search" accessibilityLabel="Sample search" />
            <SearchField
              value={search}
              onChangeText={setSearch}
              onClear={() => setSearch('')}
              placeholder="Search"
              accessibilityLabel="Sample search with clear"
            />
          </View>
        </View>

        <View className="mt-6 gap-2">
          <SectionLabel>Segmented control</SectionLabel>
          <SegmentedControl
            options={[
              { value: 'one', label: 'One' },
              { value: 'two', label: 'Two' },
              { value: 'three', label: 'Three' },
            ]}
            value={segment}
            onChange={setSegment}
            accessibilityLabel="Sample segmented control"
          />
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
          <SectionLabel>Bottom sheet</SectionLabel>
          <Button onPress={() => setBottomOpen(true)}>
            <Text>Open bottom sheet</Text>
          </Button>
          <BottomSheet
            visible={bottomOpen}
            onClose={() => setBottomOpen(false)}
            closeLabel="Close sample bottom sheet"
            title="Sample bottom sheet"
          >
            <TextField
              label="A field in a sheet"
              placeholder="Type with the keyboard up"
              accessibilityLabel="Sample bottom sheet field"
              className="mt-2"
            />
          </BottomSheet>
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

        <View className="mt-6 gap-2">
          <SectionLabel>State messages</SectionLabel>
          <View className="gap-3">
            <StateMessage kind="empty" title="No chats yet" hint="Start a chat to see it here." />
            <StateMessage kind="loading" title="Loading chats…" />
            <StateMessage
              kind="error"
              title="Could not load chats."
              hint="Check your connection and try again."
              action={{ label: 'Try again', onPress: noop }}
            />
            <StateMessage kind="loading" title="Loading more…" size="inline" />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
