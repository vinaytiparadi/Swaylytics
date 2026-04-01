"use client";

import { DATA_ANALYSIS_PROMPT_PRESETS } from "@/lib/prompt-presets";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface PresetSelectorProps {
  selectedId: string | null;
  onSelect: (presetId: string, promptText: string) => void;
}

export function PresetSelector({ selectedId, onSelect }: PresetSelectorProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
        <span className="text-muted-foreground/60 mr-1 sm:mr-2 font-mono text-[9px] sm:text-[10px] uppercase tracking-[0.2em] select-none">
          Context_Presets:
        </span>
        {DATA_ANALYSIS_PROMPT_PRESETS.map((preset) => (
          <Tooltip key={preset.id}>
            <TooltipTrigger asChild>
              <button
                onClick={() => onSelect(preset.id, preset.prompt.en)}
                className={cn(
                  "h-8 px-3 border transition-all font-mono text-[9px] uppercase tracking-wider rounded-none flex items-center justify-center",
                  selectedId === preset.id
                    ? "bg-primary/10 border-primary/40 text-primary font-bold shadow-sm shadow-primary/5"
                    : "bg-secondary/20 border-border/10 text-muted-foreground/70 hover:bg-secondary/40 hover:border-border/40 hover:text-foreground"
                )}
              >
                {preset.label.en}
              </button>
            </TooltipTrigger>
            <TooltipContent 
              side="bottom" 
              className="max-w-[280px] rounded-none border-border bg-popover/95 backdrop-blur-md font-mono text-[10px] uppercase tracking-tight p-3 shadow-xl"
            >
              <p className="leading-relaxed">{preset.description.en}</p>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}
