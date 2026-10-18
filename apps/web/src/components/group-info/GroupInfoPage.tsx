import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '../ui/icon-button';
import { ScreenHeader } from '../ui/screen-header';

export function GroupInfoPage({
  title,
  onBack,
  onClose,
  noun = 'group',
  children,
}: {
  title: string;
  onBack: () => void;
  onClose: () => void;
  noun?: 'group' | 'channel';
  children?: ReactNode;
}) {
  return (
    <>
      <ScreenHeader
        variant="sub"
        title={title}
        onBack={onBack}
        backLabel={`Back to ${noun} info`}
        right={
          <IconButton aria-label={`Close ${noun} info`} onClick={onClose}>
            <X className="size-4" aria-hidden="true" />
          </IconButton>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">{children}</div>
    </>
  );
}
