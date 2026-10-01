import type { ReactNode } from 'react';

/**
 * The one column every web settings page shares (T-0153): back arrow + title
 * + one-line description in the header, then a centered `max-w-2xl` column on
 * a 16 px gutter at 390 px wide, readable body text and bordered cards.
 *
 * `AiPageShell` keeps the bare frame (dialogs like `NewAiDialog` and panels
 * only need that); the column, section and card recipes live here so the
 * settings pages stay alike without forcing every consumer onto them.
 */
export function SettingsShell({
  title,
  subtitle,
  onBack,
  children,
}: {
  title: string;
  subtitle: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="settings-shell">
      <header className="shrink-0 border-b border-divider px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Back"
            title="Back"
            onClick={onBack}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-list-hover"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-5"
              aria-hidden="true"
            >
              <path d="m12 19-7-7 7-7" />
              <path d="M19 12H5" />
            </svg>
          </button>
          <h1 className="text-[20px] leading-7 font-semibold">{title}</h1>
        </div>
        <p className="mt-1 text-[14px] text-muted-foreground">{subtitle}</p>
      </header>
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
