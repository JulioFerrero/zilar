import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StateMessage } from '@/components/ui/state-message';
import { goBackOrHome } from '@/lib/navigation';

export default function NotFoundScreen() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 items-center justify-center bg-background" edges={['top']}>
      <StateMessage
        kind="empty"
        title="Page not found"
        action={{
          label: 'Back to chats',
          onPress: () => goBackOrHome(router),
          accessibilityLabel: 'Back to chats',
        }}
      />
    </SafeAreaView>
  );
}
