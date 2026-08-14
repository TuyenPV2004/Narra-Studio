import type {HTMLAttributes, ReactNode} from 'react';

type BadgeTone = 'neutral' | 'success' | 'warning';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  tone?: BadgeTone;
}

export function Badge({children, className = '', tone = 'neutral', ...props}: BadgeProps) {
  const classes = ['narra-badge', `narra-badge--${tone}`, className].filter(Boolean).join(' ');

  return (
    <span className={classes} {...props}>
      {children}
    </span>
  );
}
