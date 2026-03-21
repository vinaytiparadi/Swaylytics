'use client';

import { Suspense, lazy, useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';

const Dithering = lazy(() =>
  import('@paper-design/shaders-react').then((mod) => ({ default: mod.Dithering }))
);

type DitheringBackgroundProps = { className?: string };

export function DitheringBackground({ className }: DitheringBackgroundProps) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = !mounted || resolvedTheme !== 'light';

  const colorBack = isDark ? '#000000' : '#ffffff';
  const colorFront = isDark ? '#ffffff' : '#000000';
  const fallbackBg = isDark ? 'bg-black' : 'bg-white';
  const centerDim = isDark
    ? 'radial-gradient(ellipse 55% 60% at 50% 50%, rgba(0,0,0,0.75) 0%, transparent 100%)'
    : 'radial-gradient(ellipse 55% 60% at 50% 50%, rgba(255,255,255,0.82) 0%, transparent 100%)';

  return (
    <>
      <div className={cn('pointer-events-none fixed inset-0 -z-10', fallbackBg, className)}>
        <Suspense fallback={null}>
          <div className="size-full opacity-50">
            <Dithering
              colorBack={colorBack}
              colorFront={colorFront}
              shape="warp"
              type="4x4"
              speed={0.3}
              className="size-full"
              minPixelRatio={1}
            />
          </div>
        </Suspense>
      </div>

      {/* Center vignette — dims/brightens where the UI lives */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0"
        style={{ background: centerDim }}
      />
    </>
  );
}
