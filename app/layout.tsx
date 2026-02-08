import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tech Support",
  description: "Technical support competence routing demo",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <nav className="flex justify-center gap-8 border-b border-foreground/10 p-4">
          <Link href="/" className="text-foreground/70 hover:text-foreground text-sm font-medium">
            Chat
          </Link>
          <Link href="/voice" className="text-foreground/70 hover:text-foreground text-sm font-medium">
            Voice
          </Link>
          <Link href="/users" className="text-foreground/70 hover:text-foreground text-sm font-medium">
            DB Table
          </Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
