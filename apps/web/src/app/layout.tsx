import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MicroLoan OS",
  description: "Modern Microfinance Operating System",
};

/**
 * Pass-through root layout.
 *
 * The <html>/<body> document shell lives one level down so each subtree can
 * set the right `lang`: app/[locale]/layout.tsx for the localised app, and
 * app/(site)/layout.tsx for the English-only public pages. Rendering <html>
 * here as well would nest a second document inside the first.
 * Global styles are imported here, once, for both.
 */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
