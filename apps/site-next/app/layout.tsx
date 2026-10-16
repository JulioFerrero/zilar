import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Archivo, Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const display = Archivo({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--display',
});
const body = Geist({ subsets: ['latin'], variable: '--body' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--mono' });

const title = 'Zilar';
const description = 'A messenger you host yourself. Your friends and your AIs in one chat.';

export const metadata: Metadata = {
  metadataBase: new URL('https://www.zilar.app'),
  title,
  description,
  openGraph: {
    title,
    description,
    type: 'website',
    images: ['/og.jpg'],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: ['/og.jpg'],
  },
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icon.webp', type: 'image/webp' },
    ],
    apple: '/apple-touch-icon.png',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Runs before first paint, so the pinned layouts apply with no flash; without
            JavaScript the class never appears and the static layout still works. */}
        <script
          dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('anim')" }}
        />
      </head>
      <body className={`${display.variable} ${body.variable} ${mono.variable}`}>{children}</body>
    </html>
  );
}
