import { ArrowUpRight, Eye, Lock } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Button } from './button';
import { Dialog, DialogStepper } from './dialog';

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
  size?: 'sm' | 'md' | 'lg';
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

function NewAiKeyDialog() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Open New AI dialog
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="New AI"
        size="lg"
        onSubmit={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
        stepper={
          <DialogStepper
            steps={[
              { label: 'Provider', value: 'DeepSeek' },
              { label: 'Key' },
              { label: 'Model' },
              { label: 'Setup' },
            ]}
            current={1}
            onStep={() => {}}
          />
        }
        footer={
          <>
            <Button size="lg" variant="outline" onClick={() => setOpen(false)}>
              Back
            </Button>
            <Button size="lg" type="submit">
              Continue
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label htmlFor="k-key" className="text-[13px] font-medium">
              API key
            </label>
            <a
              href="https://platform.deepseek.com/api_keys"
              className="flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
            >
              Get one <ArrowUpRight className="size-3" aria-hidden="true" />
            </a>
          </div>
          <div className="well-surface flex h-10 items-center gap-2.5 rounded-[10px] px-3">
            <Lock className="size-3.5 shrink-0 text-subtle-foreground" aria-hidden="true" />
            <input
              id="k-key"
              type="password"
              defaultValue="sk-0000000000000000"
              data-autofocus
              className="min-w-0 flex-1 bg-transparent font-mono text-[13px] tracking-[1px] text-foreground outline-none"
            />
            <span
              role="img"
              aria-label="Key works"
              className="size-2 shrink-0 rounded-full bg-online ring-2 ring-well"
            />
            <button
              type="button"
              aria-label="Show key"
              className="shrink-0 text-subtle-foreground hover:text-foreground"
            >
              <Eye className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
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
  Large: (
    <OpenDialog title="Edit folder" size="lg" label="Open large dialog">
      <p className="mt-3 text-[14px] text-muted-foreground">The wider panel for folder settings.</p>
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
  NewAiKeyStep: <NewAiKeyDialog />,
};
