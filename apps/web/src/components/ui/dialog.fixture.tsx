import { useState, type ReactNode } from 'react';
import { Button } from './button';
import { Dialog } from './dialog';

function OpenDialog({
  title,
  description,
  children,
  label = 'Open dialog',
  size,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  label?: string;
  size?: 'sm' | 'md';
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
};
