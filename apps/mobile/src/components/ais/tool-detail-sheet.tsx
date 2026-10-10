import { KeyboardAvoidingView, Modal, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ToolActionsApi, ToolDetailsApi } from '@/lib/tools-api';

import { ToolDetailLoader } from './tool-detail-loader';

export { ToolDetailBody } from './tool-detail-body';
export type { ToolDetailBodyActions, ToolDetailBodyState } from './tool-detail-body';
export {
  SHEET_SCROLL_TAPS_PERSIST,
  TOOL_DETAIL_LOAD_FAILED_MESSAGE,
  TOOL_VERSION_LOAD_FAILED_MESSAGE,
} from './tool-detail-loader';

/**
 * A full-height sheet with one tool's source, version history and recent
 * runs (read only). Tapping a history row shows that version's source;
 * `toolId` null hides the sheet.
 */
export function ToolDetailSheet({
  api,
  toolId,
  onClose,
  onDeleted,
}: {
  api: ToolDetailsApi & ToolActionsApi;
  toolId: string | null;
  onClose: () => void;
  onDeleted: (toolId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={toolId !== null}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <View className="flex-1 bg-background" style={{ paddingTop: Math.max(insets.top, 16) }}>
          {toolId !== null ? (
            <ToolDetailLoader
              key={toolId}
              api={api}
              toolId={toolId}
              onClose={onClose}
              onDeleted={onDeleted}
            />
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
