"use client";

import { useId, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

/**
 * Labelled field wrapper. Labels are persistent, never placeholder-as-label,
 * and hint/error text is wired to the control with aria-describedby so the
 * reason a field is rejected is announced rather than merely coloured.
 */
export function Field({
  label,
  hint,
  error,
  optional,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  /** receives the generated id + aria wiring */
  children: (props: {
    id: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
  }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {optional && (
          <span className="text-xs text-muted-foreground">Optional</span>
        )}
      </div>

      {children({
        id,
        "aria-describedby": describedBy || undefined,
        "aria-invalid": error ? true : undefined,
      })}

      {hint && !error && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Money input. Kept as text with `inputMode="decimal"` rather than
 * `type="number"`: a number input silently discards "10." mid-typing, scrolls
 * the value on wheel, and rejects a leading "." — all of which read as the
 * field fighting the operator.
 */
export function MoneyInput({
  value,
  onChange,
  symbol = "$",
  placeholder = "0.00",
  className,
  ...props
}: {
  value: string;
  onChange: (value: string) => void;
  symbol?: string;
  placeholder?: string;
  className?: string;
} & Omit<React.ComponentProps<"input">, "value" | "onChange">) {
  return (
    <InputGroup className={className}>
      <InputGroupAddon align="inline-start">
        <InputGroupText>{symbol}</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput
        inputMode="decimal"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          // One optional decimal point, digits either side, nothing else.
          if (next === "" || /^\d*\.?\d{0,2}$/.test(next)) onChange(next);
        }}
        {...props}
      />
    </InputGroup>
  );
}

/** Non-negative integer entry — quantities. Same reasoning as MoneyInput. */
export function QuantityInput({
  value,
  onChange,
  className,
  ...props
}: {
  value: number;
  onChange: (value: number) => void;
  className?: string;
} & Omit<React.ComponentProps<"input">, "value" | "onChange">) {
  return (
    <Input
      inputMode="numeric"
      className={cn("text-right tabular-nums", className)}
      value={String(value)}
      onChange={(e) => {
        const next = e.target.value.replace(/[^\d]/g, "");
        onChange(next === "" ? 0 : Number(next));
      }}
      onFocus={(e) => e.target.select()}
      {...props}
    />
  );
}

/** A count that turns amber near the limit and destructive past it. */
export function CharCount({ value, max }: { value: string; max: number }) {
  const over = value.length > max;
  const near = !over && value.length > max * 0.9;
  return (
    <span
      className={cn(
        "tabular-nums",
        over
          ? "font-medium text-destructive"
          : near
            ? "text-foreground"
            : "text-muted-foreground"
      )}
    >
      {value.length}/{max}
    </span>
  );
}
