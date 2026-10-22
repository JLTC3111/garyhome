"use client";

import { Children, isValidElement, useRef, type AriaAttributes, type ReactNode } from "react";
import { Select } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";

type Choice = { value: string; label: ReactNode; disabled?: boolean };
type OptionProps = { value?: string | number; children?: ReactNode; disabled?: boolean };

type SelectFieldProps = Pick<AriaAttributes, "aria-label" | "aria-labelledby" | "aria-describedby" | "aria-invalid"> & {
  children: ReactNode;
  value?: string | number | null;
  defaultValue?: string | number;
  onValueChange?: (value: string) => void;
  name?: string;
  id?: string;
  form?: string;
  autoComplete?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
};

// Option elements are configuration only: no native select or option is mounted.
// Base UI supplies keyboard/typeahead, dismissal, focus and form integration.
export function SelectField({ children, value, defaultValue, onValueChange, name, id, form, autoComplete,
  required, disabled, className = "", ...accessible }: SelectFieldProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  const portal = useRef<HTMLElement | null>(null);
  const choices: Choice[] = Children.toArray(children).flatMap(child => {
    if (!isValidElement<OptionProps>(child) || child.type !== "option") return [];
    return [{ value: String(child.props.value ?? ""), label: child.props.children, disabled: child.props.disabled }];
  });

  return <Select.Root<string>
    items={choices}
    name={name}
    id={id}
    form={form}
    autoComplete={autoComplete}
    value={value === undefined ? undefined : String(value ?? "")}
    defaultValue={String(defaultValue ?? choices[0]?.value ?? "")}
    onValueChange={next => onValueChange?.(next ?? "")}
    disabled={disabled}
    required={required}
    modal={false}
    onOpenChange={open => {
      if (open) portal.current = trigger.current?.closest<HTMLElement>('[role="dialog"]') ?? document.body;
    }}
  >
    <Select.Trigger ref={trigger} className={`site-select-trigger ${className}`.trim()} {...accessible}>
      <Select.Value className="site-select-value"/>
      <Select.Icon className="site-select-chevron"><ChevronDown size={15} aria-hidden="true"/></Select.Icon>
    </Select.Trigger>
    <Select.Portal container={portal}>
      <Select.Positioner className="site-select-positioner" align="start" sideOffset={7} collisionPadding={10} alignItemWithTrigger={false} positionMethod="fixed">
        <Select.Popup className="site-select-popup">
          <Select.List className="site-select-list">
            {choices.map(choice => <Select.Item className="site-select-option" key={choice.value} value={choice.value} disabled={choice.disabled}>
              <Select.ItemText>{choice.label}</Select.ItemText>
              <Select.ItemIndicator className="site-select-indicator"><Check size={15} aria-hidden="true"/></Select.ItemIndicator>
            </Select.Item>)}
          </Select.List>
        </Select.Popup>
      </Select.Positioner>
    </Select.Portal>
  </Select.Root>;
}
