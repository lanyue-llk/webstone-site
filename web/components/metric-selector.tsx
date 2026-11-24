"use client";

import { useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";

type Props = {
  label: string;
  options: { id: string; label: string }[];
  selectedIds: string[];
  defaultIds: string[];
  requiredIds?: string[];
  onChange: (ids: string[]) => void;
  t: (text: string) => string;
};

export default function MetricSelector({ label, options, selectedIds, defaultIds, requiredIds = [], onChange, t }: Props) {
  const menu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (event.target !== null && !menu.current?.contains(event.target as Node)) menu.current?.removeAttribute("open");
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  return <details ref={menu} className="metric-selector" onKeyDown={event => {
    if (event.key === "Escape") {
      menu.current?.removeAttribute("open");
      menu.current?.querySelector("summary")?.focus();
    }
  }}>
    <summary>{t(label)} <span>{selectedIds.length} / {options.length}</span><ChevronDown size={14} aria-hidden="true" /></summary>
    <div className="metric-selector-panel">
      <fieldset aria-label={t(label)}>
        <legend className="sr-only">{t(label)}</legend>
        {options.map(option => <label key={option.id}>
          <input type="checkbox" checked={selectedIds.includes(option.id)} disabled={requiredIds.includes(option.id)}
            onChange={event => onChange(event.currentTarget.checked
              ? [...selectedIds, option.id] : selectedIds.filter(id => id !== option.id))} />
          <span>{t(option.label)}</span>
        </label>)}
      </fieldset>
      <button type="button" onClick={() => onChange(defaultIds)}>{t("Reset metrics")}</button>
    </div>
  </details>;
}
