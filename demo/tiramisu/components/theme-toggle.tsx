"use client";

import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  return (
    <Button
      variant="ghost"
      size="icon"
      className="rounded-none border border-primary/20 bg-background/50 backdrop-blur-md hover:bg-primary/10 transition-colors text-muted-foreground hover:text-primary size-10 sm:size-11"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      {theme === "dark" ? (
        <Sun className="size-4 sm:size-4.5" />
      ) : (
        <Moon className="size-4 sm:size-4.5" />
      )}
    </Button>
  );
}
