import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { InlineScript } from "@/components/inline-script";
import { Providers } from "@/components/providers";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "vietnamese"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "vietnamese"],
});

/**
 * Applies the effective theme to `<html>` before first paint so there is no
 * flash of the wrong theme (see docs: preventing flash before hydration).
 * Reads the same sources ThemeProvider's lazy init does — the stored manual
 * choice first, then `prefers-color-scheme`.
 *
 * The storage key literal must stay in sync with `THEME_STORAGE_KEY` in
 * `lib/theme.ts`; this script runs before any module can be imported.
 */
const THEME_BOOTSTRAP =
  '(function(){try{var t=localStorage.getItem("amigoact-theme")' +
  '||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");' +
  'document.documentElement.classList.toggle("dark",t==="dark")' +
  "}catch(e){}})()";

export const metadata: Metadata = {
  title: {
    default: "AmigoAct",
    template: "%s · AmigoAct",
  },
  description: "Hệ thống quản lý đăng ký và ghi nhận thành tích tình nguyện.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="vi"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <InlineScript html={THEME_BOOTSTRAP} />
      </head>
      <body className="flex min-h-full flex-col bg-neutral-50 font-sans text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
