import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";

import "./globals.css";

const display = Space_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-display" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Hello Quantum",
  description: "Workshop 1 · du code PennyLane au circuit quantique",
};

export const viewport: Viewport = { themeColor: "#04060d", viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${display.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
