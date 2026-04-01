"use client";

import { DATA_ANALYSIS_PROMPT_PRESETS } from "@/lib/prompt-presets";
import { cn } from "@/lib/utils";

interface PresetSelectorProps {
  selectedId: string | null;
  onSelect: (presetId: string, promptText: string) => void;
}

export function PresetSelector({ selectedId, onSelect }: PresetSelectorProps) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-3 text-sm">
      <span className="text-muted-foreground/60 mr-1 sm:mr-2 font-mono text-[9px] sm:text-[10px] uppercase tracking-[0.2em] select-none">
        Context_Presets:
      </span>
      {DATA_ANALYSIS_PROMPT_PRESETS.map((preset) => (
        <button
          key={preset.id}
          onClick={() => onSelect(preset.id, preset.prompt)}
          className={cn(
            "h-6 sm:h-7 px-1.5 sm:px-2 border transition-all font-mono text-[9px] sm:text-[10px] uppercase tracking-[0.15em] rounded-none flex items-center justify-center",
            selectedId === preset.id
              ? "bg-primary/10 border-primary/40 text-primary font-bold shadow-sm shadow-primary/5"
              : "bg-secondary/20 border-border/10 text-muted-foreground/70 hover:bg-secondary/40 hover:border-border/40 hover:text-foreground"
          )}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}
