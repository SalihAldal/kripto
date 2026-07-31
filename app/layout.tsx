import type { Metadata } from "next";
import { I18nProvider } from "@/src/i18n/provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "KINETIC | AI Trading Platform",
  description: "Professional AI powered crypto trading platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
