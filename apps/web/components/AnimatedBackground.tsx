'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

export function AnimatedBackground() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="fixed inset-0 z-[-1] bg-background" />;
  }

  const isDark = resolvedTheme === 'dark';

  return (
    <div
      className={`fixed inset-0 z-[-1] ${
        isDark ? 'mesh-bg-dark bg-[#2C2621]' : 'mesh-bg-light bg-[#FAFAFA]'
      }`}
    />
  );
}
