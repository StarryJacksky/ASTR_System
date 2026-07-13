"use client";

import { useId, useRef, useState } from "react";

import styles from "./EffectorWorkspace.module.css";

export interface PolicyChipEditorProps {
  readonly items: readonly string[];
  readonly locked: readonly string[];
  readonly labelMap?: Readonly<Record<string, string>>;
  readonly label: string;
  readonly placeholder: string;
  readonly disabled?: boolean;
  readonly onChange: (items: readonly string[]) => void;
}

export function PolicyChipEditor({
  items,
  locked,
  labelMap = {},
  label,
  placeholder,
  disabled = false,
  onChange,
}: PolicyChipEditorProps) {
  const labelId = useId();
  const inputId = useId();
  const [draft, setDraft] = useState("");
  const composingRef = useRef(false);
  const lockedItems = new Set(locked);

  const addDraft = (): void => {
    if (disabled) return;
    const value = draft.trim();
    if (value.length === 0 || items.includes(value)) return;
    onChange([...items, value]);
    setDraft("");
  };

  return (
    <div
      aria-labelledby={labelId}
      className={styles.chipEditor}
      role="group"
    >
      <label className={styles.label} id={labelId} htmlFor={inputId}>{label}</label>
      <div className={styles.inputRow}>
        <input
          className={styles.chipInput}
          disabled={disabled}
          id={inputId}
          placeholder={placeholder}
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            if (composingRef.current || event.nativeEvent.isComposing) return;
            addDraft();
          }}
        />
        <button
          className={styles.addButton}
          disabled={disabled}
          type="button"
          onClick={addDraft}
        >
          添加
        </button>
      </div>
      {items.length > 0 && (
        <ul className={styles.chipList}>
          {items.map((item) => {
            const itemLabel = labelMap[item] ?? item;
            const isLocked = lockedItems.has(item);
            return (
              <li
                key={item}
                className={`${styles.chip} ${isLocked ? styles.lockedChip : ""}`}
              >
                <span>{itemLabel}</span>
                {isLocked ? (
                  <span className={styles.lockedMark}>Core 锁定</span>
                ) : (
                  <button
                    aria-label={`移除 ${itemLabel}`}
                    className={styles.removeButton}
                    disabled={disabled}
                    type="button"
                    onClick={() => onChange(items.filter((candidate) => candidate !== item))}
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
