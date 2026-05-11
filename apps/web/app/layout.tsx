import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/ThemeProvider';
import { AnimatedBackground } from '@/components/AnimatedBackground';
import { Toaster } from 'sonner';

export const metadata: Metadata = {
  title: 'QuickShare',
  description: 'Zero-egress, lightning-fast, login-free P2P file and text sharing',
  manifest: '/manifest.json',
};

export const viewport = {
  themeColor: '#2C2621',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <AnimatedBackground />
          {children}
          <Toaster position="bottom-right" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
