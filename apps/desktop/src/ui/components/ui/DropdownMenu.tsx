import * as RadixDropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

export const DropdownMenu = RadixDropdownMenu.Root;
export const DropdownMenuTrigger = RadixDropdownMenu.Trigger;
export const DropdownMenuGroup = RadixDropdownMenu.Group;
export const DropdownMenuPortal = RadixDropdownMenu.Portal;
export const DropdownMenuSub = RadixDropdownMenu.Sub;
export const DropdownMenuRadioGroup = RadixDropdownMenu.RadioGroup;

export function DropdownMenuContent({
  className = "",
  sideOffset = 6,
  ...props
}: ComponentPropsWithoutRef<typeof RadixDropdownMenu.Content>) {
  return (
    <RadixDropdownMenu.Portal>
      <RadixDropdownMenu.Content
        sideOffset={sideOffset}
        className={`narra-dropdown__content ${className}`.trim()}
        {...props}
      />
    </RadixDropdownMenu.Portal>
  );
}

export function DropdownMenuItem({
  className = "",
  inset,
  ...props
}: ComponentPropsWithoutRef<typeof RadixDropdownMenu.Item> & {
  inset?: boolean;
}) {
  return (
    <RadixDropdownMenu.Item
      className={`narra-dropdown__item ${inset ? "narra-dropdown__item--inset" : ""} ${className}`.trim()}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({
  className = "",
  children,
  ...props
}: ComponentPropsWithoutRef<typeof RadixDropdownMenu.CheckboxItem>) {
  return (
    <RadixDropdownMenu.CheckboxItem
      className={`narra-dropdown__checkbox-item ${className}`.trim()}
      {...props}
    >
      <span className="narra-dropdown__item-indicator">
        <RadixDropdownMenu.ItemIndicator>
          <Check size={14} />
        </RadixDropdownMenu.ItemIndicator>
      </span>
      {children}
    </RadixDropdownMenu.CheckboxItem>
  );
}

export function DropdownMenuLabel({
  className = "",
  inset,
  ...props
}: ComponentPropsWithoutRef<typeof RadixDropdownMenu.Label> & {
  inset?: boolean;
}) {
  return (
    <RadixDropdownMenu.Label
      className={`narra-dropdown__label ${inset ? "narra-dropdown__label--inset" : ""} ${className}`.trim()}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className = "",
  ...props
}: ComponentPropsWithoutRef<typeof RadixDropdownMenu.Separator>) {
  return (
    <RadixDropdownMenu.Separator
      className={`narra-dropdown__separator ${className}`.trim()}
      {...props}
    />
  );
}

export function DropdownMenuShortcut({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={`narra-dropdown__shortcut ${className}`.trim()}>
      {children}
    </span>
  );
}
