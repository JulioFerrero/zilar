import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { View } from 'react-native';

type DismissBannerProps = {
  message: string;
  tone: 'error' | 'notice';
  onDismiss: () => void;
};

export function DismissBanner({ message, tone, onDismiss }: DismissBannerProps) {
  const isError = tone === 'error';

  return (
    <View
      className={
        isError
          ? 'mx-2 flex-row items-center justify-between rounded-[10px] bg-danger/20 px-3 py-2'
          : 'mx-2 flex-row items-center justify-between rounded-[10px] bg-surface-raised px-3 py-2'
      }
    >
      <Text
        className={
          isError ? 'flex-1 text-[13px] text-danger' : 'flex-1 text-[13px] text-muted-foreground'
        }
        accessibilityRole={isError ? 'alert' : undefined}
      >
        {message}
      </Text>
      <Button
        variant="ghost"
        size="sm"
        className="ml-2 h-7 px-2"
        accessibilityLabel={isError ? 'Dismiss error' : 'Dismiss notice'}
        onPress={onDismiss}
      >
        <Text
          className={
            isError
              ? 'text-[13px] font-semibold text-danger'
              : 'text-[13px] font-semibold text-muted-foreground'
          }
        >
          Dismiss
        </Text>
      </Button>
    </View>
  );
}
