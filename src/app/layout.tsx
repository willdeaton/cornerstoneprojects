import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cornerstone Project Tracker',
  description: 'Project pipeline, active jobs, notes and time tracking for Cornerstone Facility Solutions.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
