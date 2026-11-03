"use client";
import { useEffect, useId, useRef, useState } from "react";
import { BASEMAP_OPTIONS, type Basemap } from "@/lib/basemaps";

export default function MapSettings({ basemap, onBasemapChange, onSources }: {
  basemap: Basemap;
  onBasemapChange: (value: Basemap) => void;
  onSources: () => void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div className="header-settings" ref={container}>
      <button ref={trigger} className="settings-trigger" aria-expanded={open}
        aria-controls={id} onClick={() => setOpen((value) => !value)}>
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M3 5h14M3 10h14M3 15h14" />
          <path d="M7 3v4M13 8v4M7 13v4" strokeWidth="3" />
        </svg>
        Settings
      </button>
      {open && (
        <div id={id} className="settings-dropdown" role="region" aria-label="Map settings">
          <p className="eyebrow">BASEMAP</p>
          <div className="basemap-choices">
            {BASEMAP_OPTIONS.map((option) => (
              <button key={option.value} className="basemap-choice" aria-pressed={basemap === option.value}
                onClick={() => onBasemapChange(option.value)}>
                <img src={option.preview} alt="" width="256" height="160" loading="lazy" decoding="async" />
                <span>{option.label}</span>
              </button>
            ))}
          </div>
          <button className="settings-sources" onClick={() => { setOpen(false); onSources(); }}>
            Data &amp; sources <span aria-hidden="true">↗</span>
          </button>
        </div>
      )}
    </div>
  );
}
