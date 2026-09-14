import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { appName } from "@/config/brand";
import { ThemeProvider } from "@/ui/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * 元信息标题/描述的品牌名同样走 .env（APP_NAME）：
 * 改名只改 .env，不改动代码。服务端布局，可直接读 config/brand（非 NEXT_PUBLIC 通道）。
 */
export const metadata: Metadata = {
  title: `${appName()} · 佛系陪伴`,
  description: `${appName()} 官方默认素材包 · 手绘暖调 · 隐居模式`,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
