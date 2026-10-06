import {
  useId,
  useState,
  type ChangeEvent,
  type ComponentProps,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';

interface FieldProps {
  label?: string;
  hint?: string;
  invalid?: boolean;
  counter?: { max: number };
}

type TextInputProps = ComponentProps<'input'> & FieldProps;
type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps;

function Field({
  id,
  label,
  hint,
  invalid,
  children,
}: {
  id: string;
  label: string | undefined;
  hint: string | undefined;
  invalid: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {label === undefined ? null : (
        <label htmlFor={id} className="text-[14px] font-medium">
          {label}
        </label>
      )}
      {children}
      {hint === undefined ? null : (
        <p className={cn('text-[12px] text-subtle-foreground', invalid === true && 'text-danger')}>
          {hint}
        </p>
      )}
    </div>
  );
}

const FIELD_INPUT =
  'well-surface w-full rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-subtle-foreground disabled:pointer-events-none disabled:opacity-50';

export function TextInput({
  label,
  hint,
  invalid,
  counter,
  id,
  maxLength,
  onChange,
  className,
  ...props
}: TextInputProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const [uncontrolledLength, setUncontrolledLength] = useState(
    () => props.defaultValue?.toString().length ?? 0,
  );
  const length = typeof props.value === 'string' ? props.value.length : uncontrolledLength;
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setUncontrolledLength(event.target.value.length);
    onChange?.(event);
  };
  const field = (
    <input
      id={fieldId}
      aria-invalid={invalid === true ? true : undefined}
      maxLength={maxLength}
      className={cn(FIELD_INPUT, invalid === true && 'border-destructive', className)}
      {...props}
      onChange={handleChange}
    />
  );
  if (label === undefined && hint === undefined && counter === undefined) {
    return field;
  }
  return (
    <Field id={fieldId} label={label} hint={hint} invalid={invalid}>
      {field}
      {counter === undefined ? null : (
        <p
          className={cn(
            'self-end font-mono text-[11px] text-subtle-foreground',
            length > counter.max && 'text-danger',
          )}
        >
          {length}/{counter.max}
        </p>
      )}
    </Field>
  );
}

export function TextArea({
  label,
  hint,
  invalid,
  counter,
  id,
  maxLength,
  onChange,
  className,
  ...props
}: TextAreaProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const [uncontrolledLength, setUncontrolledLength] = useState(
    () => props.defaultValue?.toString().length ?? 0,
  );
  const length = typeof props.value === 'string' ? props.value.length : uncontrolledLength;
  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setUncontrolledLength(event.target.value.length);
    onChange?.(event);
  };
  const field = (
    <textarea
      id={fieldId}
      aria-invalid={invalid === true ? true : undefined}
      maxLength={maxLength}
      className={cn(FIELD_INPUT, 'min-h-20', invalid === true && 'border-destructive', className)}
      {...props}
      onChange={handleChange}
    />
  );
  if (label === undefined && hint === undefined && counter === undefined) {
    return field;
  }
  return (
    <Field id={fieldId} label={label} hint={hint} invalid={invalid}>
      {field}
      {counter === undefined ? null : (
        <p
          className={cn(
            'self-end font-mono text-[11px] text-subtle-foreground',
            length > counter.max && 'text-danger',
          )}
        >
          {length}/{counter.max}
        </p>
      )}
    </Field>
  );
}
