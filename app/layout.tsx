import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? 'http://localhost:3000'),
  title: 'MOTH FORGE: QUAMPUTE',
  description: 'A WebMCP creative workbench where the creator owns intent and the agent carries the labor of consequence.',
  icons: { icon: '/icon.png' },
  openGraph: {
    title: 'MOTH FORGE: QUAMPUTE',
    description: 'A WebMCP creative workbench where the creator owns intent and the agent carries the labor of consequence.',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'MOTH FORGE: QUAMPUTE — an illustrated living-system forge' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MOTH FORGE: QUAMPUTE',
    description: 'A WebMCP creative workbench where the creator owns intent and the agent carries the labor of consequence.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
