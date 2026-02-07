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
        <nav className="flex justify-end gap-4 p-4">
          <Link href="/" className="text-foreground/70 hover:text-foreground text-sm">
            Home
          </Link>
          <Link href="/users" className="text-foreground/70 hover:text-foreground text-sm">
            Users
          </Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
