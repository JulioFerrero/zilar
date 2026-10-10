import { Button } from '../ui/button';
import { FieldError } from '../ais/AiPageShell';

/** A list that failed to load: the message and a Retry button. */
export function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-2 px-2">
      <FieldError>{message}</FieldError>
      <Button type="button" size="lg" className="self-start rounded-full px-4" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

/** A list that is shown but could not be refreshed: the message and a Retry button. */
export function RefreshFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center gap-2 px-2">
      <p className="flex-1 text-[12px] text-muted-foreground">{message}</p>
      <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

/** The "Add people" / "Add my AI" opener and its Cancel, around the picker rows. */
export function PickerToggle({
  open,
  openLabel,
  onOpen,
  onCancel,
  children,
}: {
  open: boolean;
  openLabel: string;
  onOpen: () => void;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-1 flex flex-col gap-1 px-2">
      {open ? (
        <>
          {children}
          <Button type="button" variant="ghost" size="sm" className="self-start" onClick={onCancel}>
            Cancel
          </Button>
        </>
      ) : (
        <Button type="button" size="lg" className="self-start rounded-full px-4" onClick={onOpen}>
          {openLabel}
        </Button>
      )}
    </div>
  );
}
