import type { HTMLAttributes, ReactNode } from "react";

interface SurfaceProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
}

export function Surface({ children, className = "", ...props }: SurfaceProps) {
  const classes = ["narra-surface", className].filter(Boolean).join(" ");

  return (
    <section className={classes} {...props}>
      {children}
    </section>
  );
}
