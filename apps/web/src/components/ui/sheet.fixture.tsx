import { useRef, useState, type ReactNode } from 'react';
import { Button } from './button';
import { Sheet } from './sheet';

function OpenSheet({
  heading,
  children,
  label = 'Open sheet',
  ariaLabel,
  dismissable,
}: {
  heading: string;
  children?: ReactNode;
  label?: string;
  ariaLabel?: string;
  dismissable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        ariaLabel={ariaLabel ?? heading}
        {...(dismissable === undefined ? {} : { dismissable })}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-divider p-4">
          <div className="min-w-0 flex-1 truncate text-[16px] font-semibold">{heading}</div>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </Sheet>
    </div>
  );
}

function OpenPlainSheet({
  children,
  label = 'Open plain sheet',
}: {
  children: ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} ariaLabel="No header">
        {children}
      </Sheet>
    </div>
  );
}

function InitialFocusSheet() {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Open sheet with initial focus
      </Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        ariaLabel="Pinned messages"
        initialFocusRef={closeRef}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-divider p-4">
          <div className="min-w-0 flex-1 truncate text-[16px] font-semibold">Pinned messages</div>
          <Button ref={closeRef} variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <p className="text-[14px] text-muted-foreground">Focus starts on the Close button.</p>
        </div>
      </Sheet>
    </div>
  );
}

export default {
  Default: (
    <OpenSheet heading="Pinned messages">
      <p className="text-[14px] text-muted-foreground">Pin an important message to keep it here.</p>
    </OpenSheet>
  ),
  WithoutHeader: (
    <OpenPlainSheet label="Open sheet without header">
      <p className="p-4 text-[14px] text-muted-foreground">
        This sheet renders only its children: no built-in header.
      </p>
    </OpenPlainSheet>
  ),
  AccessibleName: (
    <OpenSheet heading="Channel info" ariaLabel="Channel details" label="Open named sheet">
      <p className="text-[14px] text-muted-foreground">
        The accessible name differs from the title.
      </p>
    </OpenSheet>
  ),
  NotDismissable: (
    <OpenSheet heading="Uploading…" dismissable={false} label="Open undismissable sheet">
      <p className="text-[14px] text-muted-foreground">
        Escape and the backdrop do not close this one.
      </p>
    </OpenSheet>
  ),
  InitialFocus: <InitialFocusSheet />,
  LongBody: (
    <OpenSheet heading="Pinned messages" label="Open long sheet">
      <div className="flex flex-col gap-2">
        {Array.from({ length: 40 }, (_, index) => (
          <p key={index} className="text-[14px] text-muted-foreground">
            Row {index + 1}
          </p>
        ))}
      </div>
    </OpenSheet>
  ),
};
