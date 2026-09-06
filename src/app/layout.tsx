import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: {
    default: "seem_box",
    template: "%s · seem_box",
  },
  description: "A personal toolbox of small web utilities.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-neutral-950 text-neutral-100">
        <header className="border-b border-neutral-900/80">
          <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-6 py-4">
            <Link href="/" className="font-mono text-base font-semibold tracking-tight">
              seem_box
            </Link>
            <nav className="flex items-center gap-5 text-sm text-neutral-400">
              <Link href="/" className="transition-colors hover:text-neutral-100">
                Home
              </Link>
              <Link href="/youtube-summary" className="transition-colors hover:text-neutral-100">
                YouTube Summary
              </Link>
              <Link href="/settings" className="transition-colors hover:text-neutral-100">
                Settings
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">{children}</main>
        <footer className="border-t border-neutral-900/80 py-6">
          <p className="mx-auto w-full max-w-4xl px-6 text-xs text-neutral-600">
            seem_box — built for personal use
          </p>
        </footer>
      </body>
    </html>
  );
}
