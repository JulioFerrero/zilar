import { useLocalSearchParams, useRouter } from 'expo-router';

import { RequireAuth } from '@/auth/RequireAuth';
import { ToolsPage } from '@/components/group-info/tools-page';
import { goBackOrHome } from '@/lib/navigation';

/**
 * The topic's Tools and routines page (T-1838), opened from the In this topic
 * sheet: the same page as Group info › Tools, scoped to one topic. `id` is the
 * topic id and the `group` search param is the group id the manager bit reads.
 */
export default function TopicToolsScreen() {
  return (
    <RequireAuth>
      <TopicTools />
    </RequireAuth>
  );
}

function TopicTools() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; group: string }>();
  const topicId = typeof params.id === 'string' ? params.id : '';
  const groupId = typeof params.group === 'string' ? params.group : '';
  return <ToolsPage groupId={groupId} topicId={topicId} onBack={() => goBackOrHome(router)} />;
}
