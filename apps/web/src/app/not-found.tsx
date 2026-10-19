import Link from "next/link";

/**
 * 404 for paths outside [locale] and (site). The root layout is a
 * pass-through, so this page supplies its own document shell.
 */
export default function NotFound() {
  return (
    <html lang="en">
      <body className="antialiased bg-background text-foreground">
        <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
          <h1 className="text-2xl font-semibold">Page not found</h1>
          <Link href="/en/login" className="text-sm text-indigo-600 hover:underline">
            Go to sign in
          </Link>
        </main>
      </body>
    </html>
  );
}
