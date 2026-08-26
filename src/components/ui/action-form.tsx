'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from 'react';

import { Alert } from '@/components/ui/primitives';
import { Button, type ButtonProps } from '@/components/ui/button';
import { CSRF_FIELD } from '@/lib/auth/constants';
import type { ActionResult } from '@/server/actions/shared';

/**
 * Form wrapper for server actions.
 *
 * Handles the four states every mutation needs — idle, loading, success, error —
 * in one place, so no form in the product can accidentally ship without them.
 * It also injects the CSRF token, meaning a developer cannot forget it.
 *
 * Field-level errors returned by the action are exposed through context so
 * inputs can render them inline.
 */

interface FormState {
  pending: boolean;
  error: string | null;
  fieldErrors: Record<string, string>;
  success: string | null;
}

const FormStateContext = createContext<FormState>({
  pending: false,
  error: null,
  fieldErrors: {},
  success: null,
});

export function useFormState(): FormState {
  return useContext(FormStateContext);
}

export function useFieldError(name: string): string | undefined {
  return useContext(FormStateContext).fieldErrors[name];
}

export interface ActionFormProps<T> {
  action: (formData: FormData) => Promise<ActionResult<T>>;
  children: ReactNode;
  /** Navigate here on success. Receives the action's data. */
  redirectTo?: string | ((data: T) => string);
  onSuccess?: (data: T) => void;
  /** Replaces the form body with a success message instead of navigating. */
  successMessage?: string;
  className?: string;
  /** Refresh server components after a successful mutation. */
  refresh?: boolean;
  /** Clear the form after success. */
  resetOnSuccess?: boolean;
  csrfToken: string;
  id?: string;
}

export function ActionForm<T>({
  action,
  children,
  redirectTo,
  onSuccess,
  successMessage,
  className,
  refresh = true,
  resetOnSuccess,
  csrfToken,
  id,
}: ActionFormProps<T>) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      const formData = new FormData(form);

      setError(null);
      setFieldErrors({});
      setSuccess(null);

      startTransition(async () => {
        let result: ActionResult<T>;
        try {
          result = await action(formData);
        } catch {
          // A thrown error here means the action itself failed to execute
          // (network, deploy mid-request). The typed path handles everything else.
          setError('The request could not be completed. Check your connection and try again.');
          return;
        }

        if (!result.ok) {
          setError(result.error);
          setFieldErrors(result.fieldErrors ?? {});
          // Move focus to the error so screen readers announce it.
          requestAnimationFrame(() => {
            form.querySelector<HTMLElement>('[data-form-error]')?.focus();
          });
          return;
        }

        setSuccess(result.message ?? successMessage ?? null);
        if (resetOnSuccess) form.reset();
        onSuccess?.(result.data);

        if (redirectTo) {
          const target = typeof redirectTo === 'function' ? redirectTo(result.data) : redirectTo;
          router.push(target);
          if (refresh) router.refresh();
        } else if (refresh) {
          router.refresh();
        }
      });
    },
    [action, onSuccess, redirectTo, refresh, resetOnSuccess, router, successMessage],
  );

  return (
    <FormStateContext.Provider value={{ pending: isPending, error, fieldErrors, success }}>
      <form onSubmit={handleSubmit} className={className} noValidate id={id}>
        <input type="hidden" name={CSRF_FIELD} value={csrfToken} />

        {error ? (
          <Alert tone="danger" className="mb-4">
            <span data-form-error tabIndex={-1}>
              {error}
            </span>
          </Alert>
        ) : null}

        {success && !redirectTo ? (
          <Alert tone="success" className="mb-4">
            {success}
          </Alert>
        ) : null}

        {children}
      </form>
    </FormStateContext.Provider>
  );
}

/** Submit button that reflects the enclosing form's pending state. */
export function SubmitButton({
  children,
  idleLabel,
  pendingLabel,
  ...rest
}: Omit<ButtonProps, 'type' | 'loading'> & {
  idleLabel?: string;
  pendingLabel?: string;
}) {
  const { pending } = useFormState();
  return (
    <Button type="submit" loading={pending} {...rest}>
      {pending ? (pendingLabel ?? children ?? idleLabel) : (children ?? idleLabel)}
    </Button>
  );
}

/** Fieldset that disables itself while the form is submitting. */
export function FormBody({ children, className }: { children: ReactNode; className?: string }) {
  const { pending } = useFormState();
  return (
    <fieldset disabled={pending} className={className}>
      {children}
    </fieldset>
  );
}
