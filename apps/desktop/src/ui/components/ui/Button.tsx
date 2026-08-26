import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "danger" | "ghost" | "primary" | "secondary";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: ButtonVariant;
}

export function Button({
  children,
  className = "",
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  const classes = ["narra-button", `narra-button--${variant}`, className]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} className={classes} {...props}>
      {children}
    </button>
  );
}
