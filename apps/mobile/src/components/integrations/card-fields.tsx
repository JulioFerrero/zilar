import { Eye, EyeOff } from 'lucide-react-native';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { ICON } from '@/lib/colors';

export function CardHeader({
  icon,
  title,
  pill,
}: {
  icon: React.ReactNode;
  title: string;
  pill: string;
}) {
  return (
    <View className="flex-row items-center justify-between gap-2">
      <View className="flex-row items-center gap-2">
        {icon}
        <Text className="text-[16px] font-semibold text-foreground">{title}</Text>
      </View>
      <Text className="rounded-full bg-surface-raised px-2 py-0.5 text-[12px] text-muted-foreground">
        {pill}
      </Text>
    </View>
  );
}

export function SecretField({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  show,
  onToggleShow,
  showLabel,
  editable,
  returnKeyType,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  maxLength: number;
  show: boolean;
  onToggleShow: () => void;
  showLabel: string;
  editable: boolean;
  returnKeyType: 'next' | 'done';
}) {
  return (
    <View className="gap-1">
      <Text className="text-[14px] font-medium text-foreground">{label}</Text>
      <View className="flex-row items-center gap-1">
        <TextField
          value={value}
          onChangeText={onChange}
          accessibilityLabel={label}
          secureTextEntry={!show}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          maxLength={maxLength}
          editable={editable}
          returnKeyType={returnKeyType}
          placeholder={placeholder}
          className="min-w-0 flex-1"
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full"
          accessibilityLabel={show ? `Hide ${showLabel}` : `Show ${showLabel}`}
          onPress={onToggleShow}
        >
          {show ? <EyeOff size={16} color={ICON} /> : <Eye size={16} color={ICON} />}
        </Button>
      </View>
    </View>
  );
}

export function SaveButton({
  busy,
  busyLabel,
  label,
  onPress,
}: {
  busy: boolean;
  busyLabel: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Button
      accessibilityLabel={label}
      disabled={busy}
      onPress={onPress}
      variant="default"
      size="sm"
    >
      <Text>{busy ? busyLabel : label}</Text>
    </Button>
  );
}

export function RemoveButton({
  busy,
  label,
  onPress,
}: {
  busy: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Button
      accessibilityLabel={label}
      disabled={busy}
      onPress={onPress}
      variant="outline"
      size="sm"
    >
      <Text>{label}</Text>
    </Button>
  );
}

export function RemoveConfirmDialog({
  title,
  body,
  removing,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  removing: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      visible
      title={title}
      message={body}
      error={error}
      confirmLabel="Remove"
      busyLabel="Removing…"
      busy={removing}
      onCancel={onCancel}
      onConfirm={onConfirm}
      confirmAccessibilityLabel="Confirm remove"
      destructive
    />
  );
}
