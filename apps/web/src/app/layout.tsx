import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MicroLoan OS",
  description: "Modern Microfinance Operating System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
