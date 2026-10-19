/**
 * Document shell for the public, English-only pages that live outside
 * [locale] (pricing, policies, the / redirect).
 */
export default function SiteLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased bg-background text-foreground">{children}</body>
    </html>
  );
}
