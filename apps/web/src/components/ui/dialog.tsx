import { cn } from '@/lib/utils';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Check, X } from 'lucide-react';
import { type FormEvent, type ReactNode, type RefObject, useRef, useState } from 'react';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  stepper?: ReactNode;
  error?: ReactNode;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  busy?: boolean;
  size?: 'sm' | 'md' | 'lg';
  initialFocusRef?: RefObject<HTMLElement | null>;
  ariaLabel?: string;
  dismissable?: boolean;
  /**
   * Base UI drops a nested dialog's backdrop (`DialogBackdrop` renders nothing
   * when its root is nested), which leaves the parent overlay undimmed; forcing
   * it keeps a confirm clearly modal.
   */
  forceRenderBackdrop?: boolean;
}

interface DialogHeaderProps {
  title: string;
  description?: string;
  stepper?: ReactNode;
  onClose: () => void;
  closeDisabled: boolean;
}

function DialogHeader({ title, description, stepper, onClose, closeDisabled }: DialogHeaderProps) {
  return (
    <>
      <div className="flex shrink-0 items-center gap-3 pt-4 pr-4 pl-5">
        <div className="min-w-0 flex-1">
          <DialogPrimitive.Title className="text-[18px] font-semibold tracking-[-0.02em]">
            {title}
          </DialogPrimitive.Title>
          {description === undefined ? null : (
            <DialogPrimitive.Description className="mt-1 text-[14px] text-muted-foreground">
              {description}
            </DialogPrimitive.Description>
          )}
        </div>
        <button
          type="button"
          aria-label="Close"
          disabled={closeDisabled}
          onClick={onClose}
          className="key-icon inline-flex size-8 shrink-0 items-center justify-center rounded-[10px] disabled:pointer-events-none disabled:opacity-50"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      {stepper === undefined ? null : <div className="mt-4 shrink-0 px-5">{stepper}</div>}
    </>
  );
}

function DialogBody({ children }: { children?: ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>;
}

function DialogFooter({ children }: { children?: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-3.5">
      {children}
    </div>
  );
}

function DialogError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="shrink-0 px-5 pb-3 text-[13px] text-danger">
      {children}
    </p>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  actions,
  footer,
  stepper,
  error,
  onSubmit,
  busy = false,
  size = 'md',
  initialFocusRef,
  ariaLabel,
  dismissable = true,
  forceRenderBackdrop = false,
}: DialogProps) {
  const popupRef = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);
  const closable = dismissable && !busy;

  // First focus goes to `[data-autofocus]` when one exists, otherwise to the
  // popup itself so the header close key is never focused first.
  const focusTarget = (): HTMLElement | null => {
    if (initialFocusRef !== undefined && initialFocusRef.current !== null) {
      return initialFocusRef.current;
    }
    return popupRef.current?.querySelector<HTMLElement>('[data-autofocus]') ?? popupRef.current;
  };

  const body = (
    <>
      <DialogBody>{children}</DialogBody>
      {error === undefined ? null : <DialogError>{error}</DialogError>}
      {footer === undefined && actions === undefined ? null : (
        <DialogFooter>{footer ?? actions}</DialogFooter>
      )}
    </>
  );

  return (
    <DialogPrimitive.Root
      open={open && !leaving}
      disablePointerDismissal={!closable}
      onOpenChange={(nextOpen, eventDetails) => {
        if (nextOpen) {
          return;
        }
        // `dismissable={false}` and `busy` cancel Base UI's Escape close.
        if (!closable && eventDetails.reason === 'escape-key') {
          eventDetails.cancel();
          return;
        }
        setLeaving(true);
      }}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen && leaving) {
          setLeaving(false);
          onClose();
        }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          forceRender={forceRenderBackdrop}
          className="fixed inset-0 z-40 bg-black/60 transition-opacity duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] starting:opacity-0 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 data-[ending-style]:duration-150"
        />
        <DialogPrimitive.Viewport className="fixed inset-0 z-40 flex items-center justify-center p-4 max-sm:items-end max-sm:p-0">
          <DialogPrimitive.Popup
            ref={popupRef}
            initialFocus={focusTarget}
            {...(ariaLabel === undefined
              ? {}
              : { 'aria-label': ariaLabel, 'aria-labelledby': undefined })}
            className={cn(
              'flex max-h-[85vh] w-full flex-col rounded-2xl border border-border bg-panel shadow-[0_24px_60px_rgba(0,0,0,0.8)] outline-none',
              'max-sm:max-w-none max-sm:rounded-b-none',
              'transition-[opacity,scale,translate] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] starting:opacity-0 starting:scale-[0.97] data-[starting-style]:opacity-0 data-[starting-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[ending-style]:scale-[0.97] data-[ending-style]:duration-150 max-sm:duration-300 max-sm:ease-[cubic-bezier(0.32,0.72,0,1)] max-sm:starting:opacity-100 max-sm:starting:scale-100 max-sm:starting:translate-y-full max-sm:data-[starting-style]:scale-100 max-sm:data-[starting-style]:opacity-100 max-sm:data-[starting-style]:translate-y-full max-sm:data-[ending-style]:scale-100 max-sm:data-[ending-style]:opacity-100 max-sm:data-[ending-style]:translate-y-full max-sm:data-[ending-style]:duration-200 motion-reduce:transition-opacity',
              size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-lg' : 'max-w-md',
            )}
          >
            <DialogHeader
              title={title}
              {...(description === undefined ? {} : { description })}
              {...(stepper === undefined ? {} : { stepper })}
              onClose={() => setLeaving(true)}
              closeDisabled={busy}
            />
            {onSubmit === undefined ? (
              <div className="flex min-h-0 flex-1 flex-col">{body}</div>
            ) : (
              <form noValidate onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
                {body}
              </form>
            )}
          </DialogPrimitive.Popup>
        </DialogPrimitive.Viewport>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export interface DialogStep {
  label: string;
  value?: string;
}

export interface DialogStepperProps {
  steps: DialogStep[];
  current: number;
  onStep?: (index: number) => void;
}

const SEGMENT = 'flex h-7 items-center justify-center rounded-[7px] text-[13px] font-medium';

export function DialogStepper({ steps, current, onStep }: DialogStepperProps) {
  const currentStep = steps[current];
  return (
    <div
      role="group"
      aria-label={
        currentStep === undefined
          ? 'Steps'
          : `Step ${current + 1} of ${steps.length}: ${currentStep.label}`
      }
      className="well-surface grid gap-0.5 rounded-[10px] p-[3px]"
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
    >
      {steps.map((step, index) => {
        if (index < current) {
          return (
            <button
              key={step.label}
              type="button"
              onClick={() => onStep?.(index)}
              className={cn(SEGMENT, 'gap-1.5 text-muted-foreground hover:text-foreground')}
            >
              <Check className="size-3" strokeWidth={2.6} aria-hidden="true" />
              {step.value ?? step.label}
            </button>
          );
        }
        return (
          <span
            key={step.label}
            aria-current={index === current ? 'step' : undefined}
            className={cn(
              SEGMENT,
              index === current ? 'segment-raised text-foreground' : 'text-subtle-foreground',
            )}
          >
            {step.label}
          </span>
        );
      })}
    </div>
  );
}
