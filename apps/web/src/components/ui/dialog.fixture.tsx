import { useRef, useState, type ReactNode } from 'react';
import { Button } from './button';
import { Dialog } from './dialog';

function OpenDialog({
  title,
  description,
  children,
  label = 'Open dialog',
  size,
  ariaLabel,
  dismissable,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  label?: string;
  size?: 'sm' | 'md';
  ariaLabel?: string;
  dismissable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        {...(description === undefined ? {} : { description })}
        {...(size === undefined ? {} : { size })}
        {...(ariaLabel === undefined ? {} : { ariaLabel })}
        {...(dismissable === undefined ? {} : { dismissable })}
        actions={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setOpen(false)}>Save</Button>
          </>
        }
      >
        {children}
      </Dialog>
    </div>
  );
}

function ConfirmLikeDialog() {
  const [open, setOpen] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Open confirm dialog
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Delete message?"
        description="This deletes it for everyone in the chat."
        size="sm"
        initialFocusRef={cancelRef}
        actions={
          <>
            <Button ref={cancelRef} variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => setOpen(false)}>
              Delete
            </Button>
          </>
        }
      />
    </div>
  );
}

export default {
  Default: (
    <OpenDialog title="Edit group" description="Change how this group looks to its members.">
      <p className="mt-3 text-[14px] text-muted-foreground">Dialog body content goes here.</p>
    </OpenDialog>
  ),
  Small: (
    <OpenDialog title="Leave chat?" size="sm" label="Open small dialog">
      <p className="mt-3 text-[14px] text-muted-foreground">You can rejoin later with an invite.</p>
    </OpenDialog>
  ),
  WithoutDescription: (
    <OpenDialog title="Share contact">
      <p className="mt-3 text-[14px] text-muted-foreground">Pick who receives this contact.</p>
    </OpenDialog>
  ),
  InitialFocus: <ConfirmLikeDialog />,
  AccessibleName: (
    <OpenDialog title="Add members" ariaLabel="New group" label="Open named dialog">
      <p className="mt-3 text-[14px] text-muted-foreground">The accessible name is the group.</p>
    </OpenDialog>
  ),
  NotDismissable: (
    <OpenDialog title="Importing…" dismissable={false} label="Open undismissable dialog">
      <p className="mt-3 text-[14px] text-muted-foreground">
        Escape and the backdrop do not close this one.
      </p>
    </OpenDialog>
  ),
  LongBody: (
    <OpenDialog title="A long list" label="Open long dialog">
      <div className="mt-3 flex flex-col gap-2">
        {Array.from({ length: 40 }, (_, index) => (
          <p key={index} className="text-[14px] text-muted-foreground">
            Row {index + 1}
          </p>
        ))}
      </div>
    </OpenDialog>
  ),
};
