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
    <div className="narra-tabs" role="tablist" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          className="narra-tabs__tab"
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}
