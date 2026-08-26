import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";

export const Select = RadixSelect.Root;
export const SelectGroup = RadixSelect.Group;
export const SelectValue = RadixSelect.Value;

export function SelectTrigger({
  className = "",
  children,
  ...props
}: ComponentPropsWithoutRef<typeof RadixSelect.Trigger>) {
  return (
    <RadixSelect.Trigger
      className={`narra-select__trigger ${className}`.trim()}
      {...props}
    >
      {children}
      <RadixSelect.Icon asChild>
        <ChevronDown size={15} className="narra-select__icon" />
      </RadixSelect.Icon>
    </RadixSelect.Trigger>
  );
}

export function SelectContent({
  className = "",
  children,
  position = "popper",
  sideOffset = 4,
  ...props
}: ComponentPropsWithoutRef<typeof RadixSelect.Content>) {
  return (
    <RadixSelect.Portal>
      <RadixSelect.Content
        className={`narra-select__content ${className}`.trim()}
        position={position}
        sideOffset={sideOffset}
        {...props}
      >
        <RadixSelect.ScrollUpButton className="narra-select__scroll-button">
          <ChevronUp size={14} />
        </RadixSelect.ScrollUpButton>
        <RadixSelect.Viewport className="narra-select__viewport">
          {children}
        </RadixSelect.Viewport>
        <RadixSelect.ScrollDownButton className="narra-select__scroll-button">
          <ChevronDown size={14} />
        </RadixSelect.ScrollDownButton>
      </RadixSelect.Content>
    </RadixSelect.Portal>
  );
}

export function SelectLabel({
  className = "",
  ...props
}: ComponentPropsWithoutRef<typeof RadixSelect.Label>) {
  return (
    <RadixSelect.Label
      className={`narra-select__label ${className}`.trim()}
      {...props}
    />
  );
}

export function SelectItem({
  className = "",
  children,
  ...props
}: ComponentPropsWithoutRef<typeof RadixSelect.Item>) {
  return (
    <RadixSelect.Item
      className={`narra-select__item ${className}`.trim()}
      {...props}
    >
      <span className="narra-select__item-indicator">
        <RadixSelect.ItemIndicator>
          <Check size={14} />
        </RadixSelect.ItemIndicator>
      </span>
      <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
    </RadixSelect.Item>
  );
}

export function SelectSeparator({
  className = "",
  ...props
}: ComponentPropsWithoutRef<typeof RadixSelect.Separator>) {
  return (
    <RadixSelect.Separator
      className={`narra-select__separator ${className}`.trim()}
      {...props}
    />
  );
}
