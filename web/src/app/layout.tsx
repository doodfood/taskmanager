import type { Metadata } from 'next';
import './globals.css';
import { UserProvider } from '@/context/UserContext';

export const metadata: Metadata = {
  title: 'Household Tasks',
  description: 'A trust-based household task manager',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-neutral-50 text-neutral-900 antialiased">
        <UserProvider>{children}</UserProvider>
      </body>
    </html>
  );
}
