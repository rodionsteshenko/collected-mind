import type { Metadata, Viewport } from "next";
import Link from "next/link";

import "./globals.css";

export const metadata: Metadata = {
  title: "Collected Mind",
  description: "A personal map of surprising ideas.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <header className="sticky top-0 z-30 border-b border-zinc-200/60 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span
                aria-hidden
                className="inline-block h-6 w-6 rounded-full bg-gradient-to-br from-amber-300 via-rose-400 to-violet-500"
              />
              <span>Collected Mind</span>
            </Link>
            <nav className="flex items-center gap-4 text-sm text-zinc-600 dark:text-zinc-300">
              <Link href="/advise/" className="hover:text-zinc-900 dark:hover:text-white">
                Advise
              </Link>
              <Link href="/browse/" className="hover:text-zinc-900 dark:hover:text-white">
                Browse
              </Link>
              <Link href="/search/" className="hover:text-zinc-900 dark:hover:text-white">
                Search
              </Link>
              <Link href="/favorites/" className="hover:text-zinc-900 dark:hover:text-white">
                Favorites
              </Link>
              <Link href="/history/" className="hover:text-zinc-900 dark:hover:text-white">
                History
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-10">{children}</main>
        <footer className="border-t border-zinc-200/60 px-4 py-6 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-500">
          Built from Wikipedia · local only · your signals live in this browser
        </footer>
      </body>
    </html>
  );
}
