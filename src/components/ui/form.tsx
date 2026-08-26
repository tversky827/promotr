'use client';

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

/**
 * Form controls.
 *
 * Every control wires up its own label, description and error via generated
 * ids, so `aria-describedby` and `aria-invalid` are always correct — screen
 * readers announce the error with the field rather than leaving it orphaned.
 */

const CONTROL =
  'w-full rounded-md border border-border bg-surface px-3 text-base text-fg shadow-xs ' +
  'placeholder:text-fg-subtle transition-colors ' +
  'hover:border-border-strong focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25 ' +
  'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-fg-subtle';

const INVALID = 'border-danger focus:border-danger focus:ring-danger/25';

interface FieldShellProps {
  label?: ReactNode;
  description?: ReactNode;
  error?: string | null;
  required?: boolean;
  hint?: ReactNode;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  className?: string;
}

export function FormField({
  label,
  description,
  error,
  required,
  hint,
  children,
  className,
}: FieldShellProps) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('space-y-1.5', className)}>
      {label ? (
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={id} className="text-sm font-medium text-fg">
            {label}
            {required ? (
              <span className="ml-0.5 text-danger" aria-hidden="true">
                *
              </span>
            ) : null}
          </label>
          {hint ? <span className="text-xs text-fg-subtle">{hint}</span> : null}
        </div>
      ) : null}

      {description ? (
        <p id={descriptionId} className="text-xs text-fg-muted text-pretty">
          {description}
        </p>
      ) : null}

      {children({ id, describedBy, invalid: Boolean(error) })}

      {error ? (
        <p id={errorId} className="text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  label?: ReactNode;
  description?: ReactNode;
  error?: string | null;
  hint?: ReactNode;
  /** Rendered inside the field, e.g. a currency symbol. */
  prefix?: ReactNode;
  /** Rendered inside the field on the right, e.g. a unit. */
  suffix?: ReactNode;
  containerClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, description, error, hint, prefix, suffix, className, containerClassName, required, ...rest },
  ref,
) {
  return (
    <FormField
      label={label}
      description={description}
      error={error}
      hint={hint}
      required={required}
      className={containerClassName}
    >
      {({ id, describedBy, invalid }) => (
        <div className="relative">
          {prefix ? (
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-fg-subtle">
              {prefix}
            </span>
          ) : null}
          <input
            ref={ref}
            id={id}
            required={required}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className={cn(
              CONTROL,
              'h-9.5',
              prefix && 'pl-7',
              suffix && 'pr-12',
              invalid ? INVALID : null,
              className,
            )}
            {...rest}
          />
          {suffix ? (
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-fg-subtle">
              {suffix}
            </span>
          ) : null}
        </div>
      )}
    </FormField>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  description?: ReactNode;
  error?: string | null;
  hint?: ReactNode;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, description, error, hint, className, required, rows = 4, ...rest },
  ref,
) {
  return (
    <FormField label={label} description={description} error={error} hint={hint} required={required}>
      {({ id, describedBy, invalid }) => (
        <textarea
          ref={ref}
          id={id}
          rows={rows}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn(CONTROL, 'py-2 leading-relaxed resize-y', invalid ? INVALID : null, className)}
          {...rest}
        />
      )}
    </FormField>
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode;
  description?: ReactNode;
  error?: string | null;
  hint?: ReactNode;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, description, error, hint, options, placeholder, className, required, ...rest },
  ref,
) {
  return (
    <FormField label={label} description={description} error={error} hint={hint} required={required}>
      {({ id, describedBy, invalid }) => (
        <div className="relative">
          <select
            ref={ref}
            id={id}
            required={required}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className={cn(
              CONTROL,
              'h-9.5 cursor-pointer appearance-none pr-9',
              invalid ? INVALID : null,
              className,
            )}
            {...rest}
          >
            {placeholder ? (
              <option value="" disabled>
                {placeholder}
              </option>
            ) : null}
            {options.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </option>
            ))}
          </select>
          <svg
            className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
          >
            <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
    </FormField>
  );
});

export function Checkbox({
  label,
  description,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }) {
  const id = useId();
  return (
    <div className={cn('flex gap-2.5', className)}>
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-border-strong text-primary accent-[hsl(var(--primary))] focus:ring-2 focus:ring-primary/30"
        {...rest}
      />
      <div className="min-w-0">
        <label htmlFor={id} className="cursor-pointer text-base text-fg">
          {label}
        </label>
        {description ? <p className="mt-0.5 text-xs text-fg-muted text-pretty">{description}</p> : null}
      </div>
    </div>
  );
}

export function RadioCard({
  name,
  value,
  label,
  description,
  meta,
  defaultChecked,
  checked,
  onChange,
}: {
  name: string;
  value: string;
  label: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  defaultChecked?: boolean;
  checked?: boolean;
  onChange?: (value: string) => void;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cn(
        'group relative flex cursor-pointer gap-3 rounded-lg border border-border bg-surface p-3.5 transition-colors',
        'hover:border-border-strong has-[:checked]:border-primary has-[:checked]:bg-primary-soft/40 has-[:checked]:ring-1 has-[:checked]:ring-primary/30',
      )}
    >
      <input
        id={id}
        type="radio"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        checked={checked}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        className="mt-0.5 size-4 shrink-0 cursor-pointer border-border-strong accent-[hsl(var(--primary))]"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-base font-medium text-fg">{label}</span>
          {meta ? <span className="shrink-0 text-sm text-fg-muted tnum">{meta}</span> : null}
        </div>
        {description ? (
          <p className="mt-1 text-sm text-fg-muted text-pretty">{description}</p>
        ) : null}
      </div>
    </label>
  );
}

export function Switch({
  label,
  description,
  name,
  defaultChecked,
  checked,
  onChange,
  disabled,
}: {
  label: ReactNode;
  description?: ReactNode;
  name?: string;
  defaultChecked?: boolean;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="cursor-pointer text-base font-medium text-fg">
          {label}
        </label>
        {description ? (
          <p className="mt-0.5 text-sm text-fg-muted text-pretty">{description}</p>
        ) : null}
      </div>
      <label className="relative inline-flex shrink-0 cursor-pointer items-center">
        <input
          id={id}
          name={name}
          type="checkbox"
          className="peer sr-only"
          defaultChecked={defaultChecked}
          checked={checked}
          disabled={disabled}
          onChange={onChange ? (e) => onChange(e.target.checked) : undefined}
        />
        <span className="h-5 w-9 rounded-full bg-border-strong transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-bg peer-disabled:opacity-50" />
        <span className="pointer-events-none absolute left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
      </label>
    </div>
  );
}

/** Multi-select rendered as toggleable chips — used for channels and countries. */
export function ChipGroup({
  name,
  options,
  defaultValue = [],
  columns = 3,
}: {
  name: string;
  options: Array<{ value: string; label: string }>;
  defaultValue?: string[];
  columns?: 2 | 3 | 4;
}) {
  const cols = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4' };
  return (
    <div className={cn('grid grid-cols-2 gap-2', cols[columns])}>
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            'flex cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm transition-colors',
            'hover:border-border-strong has-[:checked]:border-primary has-[:checked]:bg-primary-soft/50 has-[:checked]:text-primary',
          )}
        >
          <input
            type="checkbox"
            name={name}
            value={option.value}
            defaultChecked={defaultValue.includes(option.value)}
            className="size-3.5 shrink-0 rounded border-border-strong accent-[hsl(var(--primary))]"
          />
          <span className="truncate">{option.label}</span>
        </label>
      ))}
    </div>
  );
}
