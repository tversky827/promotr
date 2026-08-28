import type { Config } from 'tailwindcss';

/**
 * Theme tokens are CSS variables defined in globals.css, not literals here.
 * That is what lets the light and dark themes differ, and what makes the
 * product white-labelable: NEXT_PUBLIC_BRAND_PRIMARY_HSL re-themes the accent
 * across the whole application at runtime, with no rebuild.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'hsl(var(--bg) / <alpha-value>)',
        surface: 'hsl(var(--surface) / <alpha-value>)',
        'surface-raised': 'hsl(var(--surface-raised) / <alpha-value>)',
        'surface-sunken': 'hsl(var(--surface-sunken) / <alpha-value>)',
        border: 'hsl(var(--border) / <alpha-value>)',
        'border-strong': 'hsl(var(--border-strong) / <alpha-value>)',
        fg: 'hsl(var(--fg) / <alpha-value>)',
        'fg-muted': 'hsl(var(--fg-muted) / <alpha-value>)',
        'fg-subtle': 'hsl(var(--fg-subtle) / <alpha-value>)',
        primary: 'hsl(var(--primary) / <alpha-value>)',
        'primary-fg': 'hsl(var(--primary-fg) / <alpha-value>)',
        'primary-soft': 'hsl(var(--primary-soft) / <alpha-value>)',
        accent: 'hsl(var(--accent) / <alpha-value>)',
        'accent-soft': 'hsl(var(--accent-soft) / <alpha-value>)',
        success: 'hsl(var(--success) / <alpha-value>)',
        'success-soft': 'hsl(var(--success-soft) / <alpha-value>)',
        warning: 'hsl(var(--warning) / <alpha-value>)',
        'warning-soft': 'hsl(var(--warning-soft) / <alpha-value>)',
        danger: 'hsl(var(--danger) / <alpha-value>)',
        'danger-soft': 'hsl(var(--danger-soft) / <alpha-value>)',
        info: 'hsl(var(--info) / <alpha-value>)',
        'info-soft': 'hsl(var(--info-soft) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.01em' }],
        xs: ['0.75rem', { lineHeight: '1.125rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.875rem', { lineHeight: '1.375rem' }],
        md: ['0.9375rem', { lineHeight: '1.5rem' }],
        lg: ['1.0625rem', { lineHeight: '1.625rem', letterSpacing: '-0.01em' }],
        xl: ['1.25rem', { lineHeight: '1.75rem', letterSpacing: '-0.015em' }],
        '2xl': ['1.5rem', { lineHeight: '1.95rem', letterSpacing: '-0.02em' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem', letterSpacing: '-0.025em' }],
        '4xl': ['2.375rem', { lineHeight: '2.75rem', letterSpacing: '-0.03em' }],
        '5xl': ['3rem', { lineHeight: '3.25rem', letterSpacing: '-0.035em' }],
        '6xl': ['3.75rem', { lineHeight: '3.95rem', letterSpacing: '-0.04em' }],
      },
      borderRadius: {
        sm: '0.3125rem',
        DEFAULT: '0.4375rem',
        md: '0.5625rem',
        lg: '0.75rem',
        xl: '1rem',
        '2xl': '1.375rem',
      },
      boxShadow: {
        xs: '0 1px 2px 0 hsl(var(--shadow) / 0.05)',
        sm: '0 1px 3px 0 hsl(var(--shadow) / 0.07), 0 1px 2px -1px hsl(var(--shadow) / 0.05)',
        DEFAULT: '0 2px 6px -1px hsl(var(--shadow) / 0.08), 0 1px 3px -1px hsl(var(--shadow) / 0.05)',
        md: '0 6px 16px -4px hsl(var(--shadow) / 0.1), 0 2px 6px -2px hsl(var(--shadow) / 0.06)',
        lg: '0 12px 32px -8px hsl(var(--shadow) / 0.13), 0 4px 10px -4px hsl(var(--shadow) / 0.07)',
        xl: '0 24px 56px -12px hsl(var(--shadow) / 0.18)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        spin: { to: { transform: 'rotate(360deg)' } },
      },
      animation: {
        'fade-in': 'fade-in 0.18s ease-out',
        'slide-up': 'slide-up 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
};

export default config;
