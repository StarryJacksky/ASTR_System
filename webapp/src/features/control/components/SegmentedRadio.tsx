"use client";

import { useEffect, useId, useRef, type KeyboardEvent } from "react";

import styles from "./EffectorWorkspace.module.css";

export interface SegmentedRadioOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly description?: string;
}

export interface SegmentedRadioProps<Value extends string> {
  readonly label: string;
  readonly value: Value;
  readonly options: readonly SegmentedRadioOption<Value>[];
  readonly disabled?: boolean;
  readonly onChange: (value: Value) => void;
}

const deltaByKey: Readonly<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

export function SegmentedRadio<Value extends string>({
  label,
  value,
  options,
  disabled = false,
  onChange,
}: SegmentedRadioProps<Value>) {
  const legendId = useId();
  const radioRefs = useRef(new Map<Value, HTMLButtonElement>());
  const restoreFocusRef = useRef<Value | null>(null);

  useEffect(() => {
    if (disabled || restoreFocusRef.current === null) return;
    restoreFocusRef.current = null;
    radioRefs.current.get(value)?.focus();
  }, [disabled, value]);

  const selectFromKey = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ): void => {
    if (disabled || options.length === 0) return;
    let nextIndex: number | null = null;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = options.length - 1;
    else if (event.key in deltaByKey) {
      nextIndex = (currentIndex + deltaByKey[event.key] + options.length) % options.length;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const next = options[nextIndex];
    if (next.value !== value) {
      restoreFocusRef.current = next.value;
      onChange(next.value);
    }
    radioRefs.current.get(next.value)?.focus();
  };

  return (
    <fieldset className={styles.segmentedField} disabled={disabled}>
      <legend className={styles.legend} id={legendId}>{label}</legend>
      <div
        aria-labelledby={legendId}
        className={styles.radioGroup}
        role="radiogroup"
      >
        {options.map((option, index) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              ref={(node) => {
                if (node === null) radioRefs.current.delete(option.value);
                else radioRefs.current.set(option.value, node);
              }}
              aria-checked={selected}
              className={styles.radio}
              data-checked={selected}
              disabled={disabled}
              role="radio"
              tabIndex={selected ? 0 : -1}
              type="button"
              onClick={() => {
                if (!disabled && !selected) {
                  restoreFocusRef.current = option.value;
                  onChange(option.value);
                }
              }}
              onKeyDown={(event) => selectFromKey(event, index)}
            >
              <span>{option.label}</span>
              {option.description && <small>{option.description}</small>}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
