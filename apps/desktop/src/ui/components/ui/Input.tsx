import type { InputHTMLAttributes } from "react";

export function Input({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={["narra-input", className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}
