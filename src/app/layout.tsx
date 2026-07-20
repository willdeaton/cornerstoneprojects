import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cornerstone Project Tracker',
  description: 'Project pipeline, active jobs, notes and time tracking for Cornerstone Facility Solutions.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Keep the page scalable for accessibility rather than locking zoom.
  maximumScale: 5,
  themeColor: '#000000',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
