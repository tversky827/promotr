import Link from 'next/link';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'success'
  | 'outline';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-primary-fg shadow-xs hover:bg-primary/90 active:bg-primary/95 disabled:hover:bg-primary',
  secondary:
    'bg-surface text-fg border border-border shadow-xs hover:bg-surface-sunken hover:border-border-strong',
  outline:
    'bg-transparent text-fg border border-border hover:bg-surface-sunken hover:border-border-strong',
  ghost: 'bg-transparent text-fg-muted hover:bg-surface-sunken hover:text-fg',
  danger: 'bg-danger text-white shadow-xs hover:bg-danger/90',
  success: 'bg-success text-white shadow-xs hover:bg-success/90',
};

const SIZES: Record<ButtonSize, string> = {
  xs: 'h-7 px-2.5 text-xs gap-1.5 rounded',
  sm: 'h-8 px-3 text-sm gap-1.5 rounded-md',
  md: 'h-9.5 px-4 text-base gap-2 rounded-md',
  lg: 'h-11 px-5 text-md gap-2 rounded-lg',
};

const BASE =
  'inline-flex items-center justify-center font-medium whitespace-nowrap transition-colors ' +
  'disabled:pointer-events-none disabled:opacity-50 select-none';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, fullWidth, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      // A loading button must stay focusable for screen readers but reject
      // clicks, so aria-busy carries the state rather than removing the node.
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(BASE, VARIANTS[variant], SIZES[size], fullWidth && 'w-full', className)}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
});

export interface ButtonLinkProps {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
  target?: string;
  rel?: string;
  prefetch?: boolean;
}

export function ButtonLink({
  href,
  variant = 'primary',
  size = 'md',
  fullWidth,
  icon,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link
      href={href}
      className={cn(BASE, VARIANTS[variant], SIZES[size], fullWidth && 'w-full', className)}
      {...rest}
    >
      {icon}
      {children}
    </Link>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn('size-3.5 shrink-0 animate-[spin_0.7s_linear_infinite]', className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M21.5 12a9.5 9.5 0 0 0-9.5-9.5"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
