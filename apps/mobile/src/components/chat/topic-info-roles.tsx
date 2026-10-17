import { Check } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { FOREGROUND } from '@/lib/colors';
import { approverLine, approverOptions, topicAccessRows } from '@/lib/roles';
import type { CustomGroupRole } from '@/lib/roles-api';
import type { ApproverRole, TopicRole, TopicVisibility } from '@/lib/topics-api';

/**
 * An error line with a Retry button. The topic-roles and group-roles load
 * failures share this row; each keeps its own message and retry call.
 */
function RetryRow({
  message,
  retryLabel,
  onRetry,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <View className="gap-2 py-1">
      <Text accessibilityRole="alert" className="text-[13px] text-danger">
        {message}
      </Text>
      <Button
        variant="outline"
        accessibilityLabel={retryLabel}
        onPress={onRetry}
        className="self-start"
      >
        <Text>Retry</Text>
      </Button>
    </View>
  );
}

type TopicInfoRolesProps = {
  /** The topic's visibility: roles exist on private topics only. */
  visibility: TopicVisibility;
  /** The roles attached to this topic (empty until the first load). */
  roles: TopicRole[];
  rolesError: string;
  /** True while the group detail behind the manager bit is still loading:
   *  the block says the controls are loading instead of silently hiding
   *  them as a read-only view. */
  rolesLoading: boolean;
  /** A group-roles load failure: the add picker names it with a Retry
   *  instead of silently degrading to attached-only. */
  groupRolesError: string;
  approverRole: ApproverRole | null;
  /** The group's roles, for the manager's add picker. */
  groupRoles: CustomGroupRole[];
  canManageRoles: boolean;
  onToggleTopicRole: (roleId: string) => void;
  onPickApprover: (roleId: string | null) => void;
  onRetryRoles: () => void;
  onRetryGroupRoles: () => void;
};

/**
 * The topic-info sheet's roles block (split out of `topic-info-sheet.tsx` in
 * T-1785): the attached access rows, the manager's add picker and the approver
 * picker. Behaviour is unchanged by the split.
 */
export function TopicInfoRoles({
  visibility,
  roles,
  rolesError,
  rolesLoading,
  groupRolesError,
  approverRole,
  groupRoles,
  canManageRoles,
  onToggleTopicRole,
  onPickApprover,
  onRetryRoles,
  onRetryGroupRoles,
}: TopicInfoRolesProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [approverOpen, setApproverOpen] = useState(false);
  // The picker rows and approver options come from the shared helpers, so
  // the block renders exactly what the unit tests pin (attached first, the
  // rest sorted by name).
  const accessRows = topicAccessRows(visibility, roles, groupRoles);
  const attachedRows = accessRows.filter((row) => row.attached);
  const addableRows = accessRows.filter((row) => !row.attached);
  const approverOpts = approverOptions(roles, approverRole);
  const line = approverLine(approverRole);

  // T-1838: a public topic has no roles at all, so the block is absent rather
  // than a line about a feature that is not there.
  if (visibility !== 'private') {
    return null;
  }

  return (
    <View>
      <Text className="text-[13px] font-semibold text-muted-foreground">Roles</Text>
      {rolesError !== '' ? (
        <RetryRow
          message={rolesError}
          retryLabel="Retry loading topic roles"
          onRetry={onRetryRoles}
        />
      ) : rolesLoading ? (
        <Text className="py-1 text-[14px] text-muted-foreground">Checking your role…</Text>
      ) : (
        <View>
          {roles.length === 0 ? (
            <StateMessage
              kind="empty"
              size="inline"
              title="No roles here yet — only the people above can see this topic."
            />
          ) : null}
          {attachedRows.map((row) => (
            <View key={row.id} className="flex-row items-center gap-2 py-1">
              <Text numberOfLines={1} className="min-w-0 flex-1 text-[15px]">
                {row.label}
              </Text>
              {canManageRoles ? (
                <Button
                  variant="outline"
                  size="sm"
                  accessibilityLabel={`Remove ${row.label} from the topic`}
                  onPress={() => onToggleTopicRole(row.id)}
                >
                  <Text>Remove</Text>
                </Button>
              ) : null}
            </View>
          ))}
          {groupRolesError !== '' ? (
            <RetryRow
              message={groupRolesError}
              retryLabel="Retry loading group roles"
              onRetry={onRetryGroupRoles}
            />
          ) : null}
          {canManageRoles ? (
            pickerOpen ? (
              <View className="gap-1 py-1">
                {addableRows.map((row) => (
                  <Button
                    key={row.id}
                    variant="outline"
                    size="sm"
                    accessibilityLabel={`Add ${row.label} to the topic`}
                    onPress={() => onToggleTopicRole(row.id)}
                  >
                    <Text>{row.label}</Text>
                  </Button>
                ))}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Done adding roles"
                  onPress={() => setPickerOpen(false)}
                  className="self-start rounded-[10px] px-3 py-1.5 active:bg-surface-raised"
                >
                  <Text className="text-[14px] text-foreground">Done</Text>
                </Pressable>
              </View>
            ) : addableRows.length > 0 ? (
              <Button
                accessibilityLabel="Add roles to the topic"
                onPress={() => setPickerOpen(true)}
                className="self-start"
              >
                <Text>Add roles</Text>
              </Button>
            ) : null
          ) : null}
          {canManageRoles ? (
            approverOpen ? (
              <View className="gap-1 py-1">
                {approverOpts.map((option) => (
                  <Pressable
                    key={option.id ?? 'none'}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: option.selected }}
                    accessibilityLabel={`Approvers: ${option.label}`}
                    onPress={() => {
                      setApproverOpen(false);
                      onPickApprover(option.id);
                    }}
                    className="flex-row items-center gap-2 rounded-xl border border-border-strong px-2 py-1.5 active:bg-surface-raised disabled:opacity-50"
                  >
                    <Text numberOfLines={1} className="min-w-0 flex-1 text-[14px]">
                      {option.label}
                    </Text>
                    {option.selected ? <Check size={16} color={FOREGROUND} /> : null}
                  </Pressable>
                ))}
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Choose approvers"
                onPress={() => setApproverOpen(true)}
                className="flex-row items-center gap-2 py-1 active:opacity-80 disabled:opacity-50"
              >
                <Text className="text-[13px] font-medium text-muted-foreground">Approvers</Text>
                <Text className="text-[14px] text-foreground">
                  {approverRole?.name ?? 'Owner and admins only'}
                </Text>
              </Pressable>
            )
          ) : line !== undefined ? (
            <Text className="py-1 text-[13px] text-muted-foreground">{line}</Text>
          ) : null}
        </View>
      )}
    </View>
  );
}
