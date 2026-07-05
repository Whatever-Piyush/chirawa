'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors ' +
  'disabled:pointer-events-none disabled:opacity-50 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40';

const variantClass: Record<Variant, string> = {
  primary: 'bg-primary text-white shadow-primary hover:bg-primary-dark',
  secondary: 'bg-primary-light text-primary hover:bg-primary-mid',
  ghost: 'bg-transparent text-ink hover:bg-surface-alt',
};

const sizeClass: Record<Size, string> = {
  sm: 'h-9 px-4 text-sm',
  md: 'h-11 px-5 text-md',
  lg: 'h-14 px-7 text-lg',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className = '', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`${base} ${variantClass[variant]} ${sizeClass[size]} ${className}`}
      {...props}
    />
  );
});
