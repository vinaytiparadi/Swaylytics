"use client";

import { DATA_ANALYSIS_PROMPT_PRESETS } from "@/lib/prompt-presets";
import { Badge } from "@/components/ui/badge";
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
      <div className="flex flex-wrap gap-2 justify-center">
        {DATA_ANALYSIS_PROMPT_PRESETS.map((preset) => (
          <Tooltip key={preset.id}>
            <TooltipTrigger asChild>
              <Badge
                variant={selectedId === preset.id ? "default" : "outline"}
                className={cn(
                  "cursor-pointer text-sm px-3 py-1.5 transition-all hover:scale-105",
                  selectedId === preset.id &&
                    "ring-2 ring-ring ring-offset-2 ring-offset-background"
                )}
                onClick={() => onSelect(preset.id, preset.prompt.en)}
              >
                {preset.label.en}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[250px]">
              <p className="text-sm">{preset.description.en}</p>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}
