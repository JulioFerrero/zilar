import type { ReactNode } from 'react';
import { ScreenHeader } from '@/components/ui/screen-header';

/** The column every settings page shares: `max-w-2xl` on a 16 px gutter at 390 px. */
export function SettingsShell({
  title,
  subtitle,
  action,
  onBack,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="settings-shell">
      <ScreenHeader
        variant="sub"
        title={title}
        subtitle={subtitle}
        onBack={onBack}
        right={action}
      />
      <div className="flex-1 overflow-auto p-4">{children}</div>
    </div>
  );
}

export const SETTINGS_COLUMN = 'mx-auto flex w-full max-w-2xl flex-col gap-4';
