import type { ReactNode } from 'react';
import { ScreenHeader } from '@/components/ui/screen-header';

/**
 * The one column every web settings page shares (T-0153): the kit
 * `ScreenHeader` row (T-1949), then a centered `max-w-2xl` column on a 16 px
 * gutter at 390 px wide, readable body text and bordered cards.
 *
 * The column, section and card recipes live here so the settings pages stay
 * alike without forcing every consumer onto them.
 */
export function SettingsShell({
  title,
  subtitle,
  action,
  onBack,
  children,
}: {
  title: string;
  subtitle?: string;
  /** An optional key at the right end of the title row (T-1503). */
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

/**
 * The centered settings column itself (same width Stickers used before the
 * shell existed). Every page wraps its body in this so the column class is
 * one shared constant, asserted by one test per page.
 */
export const SETTINGS_COLUMN = 'mx-auto flex w-full max-w-2xl flex-col gap-4';
