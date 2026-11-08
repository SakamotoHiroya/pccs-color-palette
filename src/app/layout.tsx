import type { Metadata, Viewport } from "next";
import { Noto_Serif_JP } from "next/font/google";
import "./globals.css";

// Mincho web font, used where no system Mincho (Hiragino / Yu Mincho) exists.
const mincho = Noto_Serif_JP({
  weight: "variable",
  display: "swap",
  preload: false,
  variable: "--font-mincho",
});

export const metadata: Metadata = {
  description: "HSBカラーピッカー上にPCCS（日本色研配色体系）の明度・彩度・トーンの範囲を表示するカラーパレット",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={mincho.variable}>
      <body>{children}</body>
    </html>
  );
}
