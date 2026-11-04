import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Montserrat autoallotjada (llicència OFL): sense peticions a Google Fonts.
const montserrat = localFont({
  src: "./fonts/montserrat-latin-wght-normal.woff2",
  variable: "--font-montserrat",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ModularDom CRM",
  description: "Gestió comercial i d'obra de ModularDom",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ca" className={`${montserrat.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
