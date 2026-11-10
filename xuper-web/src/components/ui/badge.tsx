import * as React from 'react';
import { cn } from '@/lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'success';
}

function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  const variants = {
    default: 'border-transparent bg-zinc-100 text-zinc-900',
    secondary: 'border-transparent bg-zinc-800 text-zinc-100 hover:bg-zinc-700',
    destructive: 'border-transparent bg-red-900/60 text-red-200 border border-red-700/50',
    outline: 'text-zinc-300 border-zinc-700/80',
    success: 'border-transparent bg-emerald-950/80 text-emerald-400 border border-emerald-800/60',
  };

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-400',
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

export { Badge };
