import type { ReactNode } from 'react';

import { SettingsScreenShell } from '@/components/settings/screen-shell';

type AisScreenShellProps = {
  title: string;
  subtitle?: string | undefined;
  onBack?: (() => void) | undefined;
  right?: ReactNode;
  scroll?: boolean;
  footer?: ReactNode;
  tabName?: string | undefined;
  children: ReactNode;
};

export function AisScreenShell({ scroll = false, ...props }: AisScreenShellProps) {
  return <SettingsScreenShell {...props} scroll={scroll} />;
}
