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

/** A settings section: a heading, then stacked cards. */
export function SettingsSection({
  label,
  title,
  action,
  children,
}: {
  label: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[16px] font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * One bordered card in a settings section. Readable title, muted second line,
 * and actions (as labeled buttons or icon buttons) in `actions`.
 */
export function SettingsCard({
  title,
  detail,
  actions,
  children,
}: {
  title: ReactNode;
  detail?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
      <span className="min-w-0 flex-1 basis-40">
        <span className="block truncate text-[15px] font-medium">{title}</span>
        {detail !== undefined && (
          <span className="mt-0.5 block text-[13px] text-muted-foreground">{detail}</span>
        )}
      </span>
      {children}
      {actions !== undefined && (
        <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">{actions}</span>
      )}
    </div>
  );
}

/** A short, friendly empty state inside the column. */
export function SettingsEmpty({ children }: { children: ReactNode }) {
  return <p className="text-[14px] text-muted-foreground">{children}</p>;
}
