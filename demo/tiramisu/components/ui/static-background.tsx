'use client';

import React from 'react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';

export function StaticBackground({ className }: { className?: string }) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className={cn("fixed inset-0 -z-10 bg-background", className)} />;
  }

  const isDark = resolvedTheme === 'dark';

  return (
    <div className={cn("fixed inset-0 -z-10 overflow-hidden bg-background", className)}>
      {/* Base Grain Texture - CSS based for performance */}
      <div className="absolute inset-0 opacity-[0.03] dark:opacity-[0.05] pointer-events-none"
        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3Y%3Cfilter id='noiseFilter'%3Y%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}>
      </div>

      {/* Primary Technical Grid */}
      <div className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(to right, ${isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)'} 1px, transparent 1px), 
                               linear-gradient(to bottom, ${isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)'} 1px, transparent 1px)`,
          backgroundSize: '80px 80px'
        }}>
      </div>

      {/* Secondary Dot Grid */}
      <div className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'} 1px, transparent 1px)`,
          backgroundSize: '20px 20px'
        }}>
      </div>

      {/* Decorative Blueprint Elements */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-20 dark:opacity-30">
        {/* Corner Viewfinders */}
        <div className="absolute top-10 left-10 w-20 h-20 border-t border-l border-primary/40" />
        <div className="absolute top-10 right-10 w-20 h-20 border-t border-r border-primary/40" />
        <div className="absolute bottom-10 left-10 w-20 h-20 border-b border-l border-primary/40" />
        <div className="absolute bottom-10 right-10 w-20 h-20 border-b border-r border-primary/40" />

        {/* Technical Labels */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 font-mono text-[8px] uppercase tracking-[0.3em] text-muted-foreground/50">
          Ref: X.COM // @vinaytiparadi
        </div>
        <div className="absolute bottom-10 left-4 rotate-90 origin-left font-mono text-[8px] uppercase tracking-[0.3em] text-muted-foreground/50">
          Scale 1:1.0024
        </div>

        {/* Center Registration Mark */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center opacity-40">
          <div className="absolute w-full h-[1px] bg-primary/30" />
          <div className="absolute h-full w-[1px] bg-primary/30" />
          <div className="w-2 h-2 rounded-full border border-primary/50" />
        </div>
      </div>

      {/* Subtle Vignette for Depth */}
      <div className="absolute inset-0 pointer-events-none shadow-[inset_0_0_150px_rgba(0,0,0,0.05)] dark:shadow-[inset_0_0_150px_rgba(0,0,0,0.2)]" />
    </div>
  );
}
