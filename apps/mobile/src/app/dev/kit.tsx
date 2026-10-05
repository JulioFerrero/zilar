/**
 * Hidden mobile kit catalog (T-0264): reachable only by the `zilar://dev/kit`
 * URL, linked from nowhere. It renders every `components/ui` kit component with
 * sample content so the kit can be eyeballed on-device. It stays unlinked in
 * release builds too: no tab, no button, no router push.
 */
import { Bell, FolderOpen, UserRound } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { Button } from '@/components/ui/button';
import { Card, SectionLabel } from '@/components/ui/card';
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
      </ScrollView>
    </SafeAreaView>
  );
}
