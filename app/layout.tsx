import type { Metadata } from 'next';
import './globals.css';
import 'animate.css';
import 'katex/dist/katex.min.css';
import { ThemeProvider } from '@/lib/hooks/use-theme';
import { I18nProvider } from '@/lib/hooks/use-i18n';
import { Toaster } from '@/components/ui/sonner';
import { ServerProvidersInit } from '@/components/server-providers-init';
import { LocalSeedBootstrap } from '@/components/local-seed-bootstrap';
import { getEmbeddedAppFontCss } from '@/lib/constants/fonts';
import { getThemeInitScript } from '@/lib/theme/theme-runtime';
import { DesktopUpdater } from '@/components/desktop-updater';

export const metadata: Metadata = {
  title: 'BinGo',
  description:
    'The open-source AI interactive classroom. Upload a PDF to instantly generate an immersive, multi-agent learning experience.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: getThemeInitScript() }} />
        <style dangerouslySetInnerHTML={{ __html: getEmbeddedAppFontCss() }} />
      </head>
      <body className="antialiased" suppressHydrationWarning>
        <ThemeProvider>
          <I18nProvider>
            <LocalSeedBootstrap />
            <ServerProvidersInit />
            {children}
            <DesktopUpdater />
            <Toaster position="top-center" />
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
