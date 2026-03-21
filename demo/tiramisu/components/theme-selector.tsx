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
          className="flex h-8 items-center gap-1.5 rounded-full bg-secondary px-3 text-sm text-foreground transition-colors hover:bg-secondary/80"
          onClick={(e) => e.stopPropagation()}
        >
          <Palette className="size-3.5 text-muted-foreground" />
          <span>{current.label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-44 rounded-2xl border border-border bg-popover p-2 shadow-xl"
        align="start"
        side="top"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="px-2 pb-1.5 pt-0.5 text-xs font-medium text-muted-foreground">
          Report Theme
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
                  "flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                  isSelected && "bg-accent text-accent-foreground"
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
