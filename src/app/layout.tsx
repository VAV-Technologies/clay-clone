import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { SiteBackground } from '@/components/ui/SiteBackground';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

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
    <html lang="en" className="dark">
      <body className={inter.className}>
        <SiteBackground />
        {children}
      </body>
    </html>
  );
}
