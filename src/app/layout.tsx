import type { Metadata, Viewport } from "next";
import { Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { Pwa } from "@/components/pwa";
import "./globals.css";

// Two signature faces: a characterful serif for titles and a tabular mono for figures.
// Body text stays on the system sans so the app feels native on a phone.
const display = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-display-loaded",
  display: "swap",
  fallback: ["Georgia", "Times New Roman", "serif"],
});

const numeric = JetBrains_Mono({
  weight: ["500", "600"],
  subsets: ["latin"],
  variable: "--font-numeric-loaded",
  display: "swap",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
});

export const metadata: Metadata = {
  title: { default: "Darkpools", template: "%s · Darkpools" },
  description: "Personal trading journal",
  applicationName: "Darkpools",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Darkpools" },
};

export const viewport: Viewport = {
  themeColor: "#0b0d12",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`h-full antialiased ${display.variable} ${numeric.variable}`}>
      <body className="flex min-h-full flex-col">
        <Pwa />
        {children}
      </body>
    </html>
  );
}
