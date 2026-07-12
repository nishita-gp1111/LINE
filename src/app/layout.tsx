import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getServerEnv } from "@/lib/env/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "LINE CRM",
  description: "社内向けLINEマーケティング・CRM基盤"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  getServerEnv();

  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
