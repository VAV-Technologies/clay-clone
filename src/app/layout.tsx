import type { Metadata } from 'next';
import { DM_Sans, DM_Serif_Display } from 'next/font/google';
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
    <html lang="en" className={`dark ${dmSans.variable} ${dmSerifDisplay.variable}`}>
      <body className={dmSans.className}>
        <AnimatedBackground />
        {children}
      </body>
    </html>
  );
}
