import type { Metadata, Viewport } from "next";
import { M_PLUS_Rounded_1c } from "next/font/google";
import "./globals.css";

// 日本語フォントは文字数が多いので、先読みせず必要な分だけ読み込む
const rounded = M_PLUS_Rounded_1c({
  variable: "--font-rounded",
  weight: ["500", "700", "800"],
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "いそがし予報 | シフトを作る前に、街のいそがしさがわかる",
  description: "シフトを作る前に、街の“いそがしさ”がわかるアプリ。",
};

export const viewport: Viewport = {
  themeColor: "#faf8f3",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className={`${rounded.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
