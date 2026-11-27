import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Webstone",
  icons: { icon: [{ url: "/brand/stone-32.png", sizes: "32x32", type: "image/png" }, { url: "/brand/stone-64.png", sizes: "64x64", type: "image/png" }, { url: "/brand/stone-192.png", sizes: "192x192", type: "image/png" }], apple: "/brand/stone-180.png" },
  description: "Find the right tools for your agent to browse the web.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
