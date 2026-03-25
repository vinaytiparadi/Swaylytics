"use client";

import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Palette, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const REPORT_THEMES = [
  { id: "modern", label: "Modern" },
  { id: "literature", label: "Literature" },
  { id: "academic", label: "Academic" },
  { id: "minimal", label: "Minimal" },
  { id: "business", label: "Business" },
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
          className="group flex h-10 sm:h-11 items-center gap-0 rounded-none bg-secondary/30 text-[9px] sm:text-[10px] font-mono uppercase tracking-[0.25em] text-foreground transition-all hover:bg-secondary/60 border border-border/20 hover:border-border/50"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-10 h-10 sm:w-11 sm:h-11 flex items-center justify-center border-r border-border/20 bg-secondary/40 transition-colors">
            <Palette className="size-3.5 sm:size-4 text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
          <span className="px-3 sm:px-4 font-bold mt-0.5">{current.label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-48 rounded-none border border-border bg-popover p-1.5 shadow-xl"
        align="start"
        side="top"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="px-3 pb-2 pt-1 font-mono text-[9px] uppercase tracking-widest text-muted-foreground/80 border-b border-border/30 mb-1">
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
                  "flex w-full items-center justify-between rounded-none px-3 py-2 text-xs font-mono uppercase tracking-wider transition-colors hover:bg-accent hover:text-accent-foreground border-l-2 border-transparent hover:border-primary",
                  isSelected && "bg-accent/50 text-accent-foreground border-primary"
                )}
              >
                <span className="font-medium">{t.label}</span>
                {isSelected && <Check className="size-3.5 text-muted-foreground" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
