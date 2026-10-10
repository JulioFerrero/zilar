import { Trash2 } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { DANGER } from '@/lib/colors';

/**
 * The save feedback, the Save/Cancel row and the delete button. The two
 * confirm dialogs stay in the route shell, outside the content column.
 */
export function PackActions({
  saving,
  progress,
  formError,
  isCreate,
  saveDisabled,
  packId,
  title,
  onSave,
  onBack,
  onAskDelete,
}: {
  saving: boolean;
  progress: { done: number; total: number } | undefined;
  formError: string;
  isCreate: boolean;
  saveDisabled: boolean;
  packId: string | undefined;
  title: string;
  onSave: () => void;
  onBack: () => void;
  onAskDelete: () => void;
}) {
  return (
    <>
      {saving && progress !== undefined && progress.total > 0 ? (
        <View accessibilityLiveRegion="polite">
          <Text className="text-[14px] text-muted-foreground">
            Uploading {progress.done} of {progress.total}…
          </Text>
        </View>
      ) : null}
      {formError !== '' ? (
        <Text accessibilityRole="alert" className="text-[14px] text-danger">
          {formError}
        </Text>
      ) : null}

      <View className="flex-row items-center gap-2">
        <Button
          variant="default"
          size="sm"
          accessibilityLabel={isCreate ? 'Create pack' : 'Save'}
          disabled={saveDisabled}
          onPress={onSave}
        >
          <Text>{saving ? 'Saving…' : isCreate ? 'Create pack' : 'Save'}</Text>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          accessibilityLabel="Cancel"
          disabled={saving}
          onPress={onBack}
        >
          <Text>Cancel</Text>
        </Button>
      </View>

      {packId !== undefined ? (
        <View className="gap-2 border-t border-divider pt-4">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Delete ${title === '' ? 'pack' : title}`}
            disabled={saving}
            onPress={onAskDelete}
            className="h-11 flex-row items-center justify-center gap-2 rounded-full border border-danger disabled:opacity-60"
          >
            <Trash2 size={16} color={DANGER} />
            <Text className="text-[15px] font-medium text-danger">Delete pack</Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}
