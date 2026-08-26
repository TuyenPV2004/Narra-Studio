import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ComponentPropsWithoutRef } from "react";

export const TooltipProvider = RadixTooltip.Provider;
export const Tooltip = RadixTooltip.Root;
export const TooltipTrigger = RadixTooltip.Trigger;

export function TooltipContent({
  className = "",
  sideOffset = 4,
  ...props
}: ComponentPropsWithoutRef<typeof RadixTooltip.Content>) {
  return (
    <RadixTooltip.Portal>
      <RadixTooltip.Content
        sideOffset={sideOffset}
        className={`narra-tooltip__content ${className}`.trim()}
        {...props}
      />
    </RadixTooltip.Portal>
  );
}
