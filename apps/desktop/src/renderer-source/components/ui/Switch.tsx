import * as RadixSwitch from "@radix-ui/react-switch";
import type { ComponentPropsWithoutRef } from "react";

export function Switch({
  className = "",
  ...props
}: ComponentPropsWithoutRef<typeof RadixSwitch.Root>) {
  return (
    <RadixSwitch.Root className={`narra-switch ${className}`.trim()} {...props}>
      <RadixSwitch.Thumb className="narra-switch__thumb" />
    </RadixSwitch.Root>
  );
}
