"use client";

import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Palette, Check, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const REPORT_THEMES = [
  { id: "modern", label: "Modern" },
  { id: "literature", label: "Literature" },
  { id: "academic", label: "Academic" },
  { id: "minimal", label: "Minimal" },
  { id: "business", label: "Business" },
  { id: "surprise", label: "Surprise me" },
] as const;

interface ThemeSelectorProps {
  value: string;
  onValueChange: (value: string) => void;
}

export function ThemeSelector({ value, onValueChange }: ThemeSelectorProps) {
  const [open, setOpen] = useState(false);
  const current = REPORT_THEMES.find((t) => t.id === value) ?? REPORT_THEMES[0];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="group flex size-10 sm:size-11 items-center justify-center rounded-none bg-secondary/30 transition-all hover:bg-secondary/60 border border-border/20 hover:border-border/50 flex-shrink-0"
          title={`Report Theme: ${current.label}`}
          onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        >
          <Palette className="size-4 sm:size-4.5 text-primary group-hover:scale-110 transition-transform" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-48 rounded-none border border-border bg-popover/95 backdrop-blur-md p-1.5 shadow-xl"
        align="start"
        side="top"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="px-3 pb-2 pt-1 font-mono text-[9px] uppercase tracking-[0.25em] text-muted-foreground/80 border-b border-border/30 mb-1">
          Select_Theme
        </p>
        <div className="space-y-0.5">
          {REPORT_THEMES.map((t) => {
            const isSelected = t.id === value;
            return (
              <button
                key={t.id}
                onClick={() => {
                  onValueChange(t.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-none px-3 py-2 text-[10px] font-mono uppercase tracking-widest transition-colors hover:bg-accent hover:text-accent-foreground border-l-2 border-transparent hover:border-primary",
                  isSelected && "bg-accent/50 text-accent-foreground border-primary"
                )}
              >
                <span className="font-bold flex items-center gap-1.5">
                  {t.label}
                  {t.id === "surprise" && <Sparkles className="size-3 text-primary/70" />}
                </span>
                {isSelected && <Check className="size-3.5 text-muted-foreground" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
