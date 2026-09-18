import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Darkpools", template: "%s · Darkpools" },
  description: "Personal trading journal",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#0b0d12",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
