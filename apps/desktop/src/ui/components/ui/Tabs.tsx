import * as RadixTabs from "@radix-ui/react-tabs";
import type { ReactNode } from "react";

export interface TabOption<T extends string> {
  label: string;
  value: T;
  icon?: ReactNode;
}

interface TabsProps<T extends string> {
  ariaLabel: string;
  onChange: (value: T) => void;
  options: readonly TabOption<T>[];
  value: T;
}

export function Tabs<T extends string>({
  ariaLabel,
  onChange,
  options,
  value,
}: TabsProps<T>) {
  return (
    <RadixTabs.Root
      value={value}
      onValueChange={(val) => onChange(val as T)}
      className="narra-tabs"
      aria-label={ariaLabel}
    >
      <RadixTabs.List className="narra-tabs__list" aria-label={ariaLabel}>
        {options.map((option) => (
          <RadixTabs.Trigger
            key={option.value}
            value={option.value}
            className="narra-tabs__tab"
          >
            {option.icon}
            <span>{option.label}</span>
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
    </RadixTabs.Root>
  );
}
