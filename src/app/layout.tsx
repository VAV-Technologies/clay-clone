import type { Metadata } from 'next';
import { DM_Sans, DM_Serif_Display, Cormorant_Garamond } from 'next/font/google';
import { AnimatedBackground } from '@/components/ui/AnimatedBackground';
import './globals.css';

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-dm-sans',
});

const dmSerifDisplay = DM_Serif_Display({
  subsets: ['latin'],
  weight: ['400'],
  style: ['normal', 'italic'],
  variable: '--font-display',
});

// Used by the homepage greeting ("Good <time of day>," / "What would you like
// to build today?") and the agent chat header. Cormorant Garamond's lightest
// weight is 300 — paired with low opacity it reads as ultra-thin/elegant.
const cormorantGaramond = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  style: ['normal', 'italic'],
  variable: '--font-cormorant',
});

export const metadata: Metadata = {
  title: 'DataFlow - AI-Powered Data Enrichment',
  description: 'Clay.com-inspired AI-powered spreadsheet application for data enrichment',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${dmSans.variable} ${dmSerifDisplay.variable} ${cormorantGaramond.variable}`}>
      <body className={dmSans.className}>
        <AnimatedBackground />
        {children}
      </body>
    </html>
  );
}
