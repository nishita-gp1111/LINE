import type { Metadata } from "next";
import { LiffAcquisitionClient } from "@/app/liff/acquisition/liff-acquisition-client";
import {
  ACQUISITION_ROUTES,
  buildLineAcquisitionUrl,
  buildLineFriendUrl
} from "@/lib/acquisition/routes";
import { getServerEnv } from "@/lib/env/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "友だち追加を確認 | GP PRモニター窓口",
  description: "LINEの友だち追加を確認し、ご案内経路を登録します。",
  robots: { index: false, follow: false }
};

export default function LiffAcquisitionPage() {
  const env = getServerEnv();
  const basicId = env.LINE_EXPECTED_BASIC_ID || "";
  let friendUrl = "";
  let fallbackMessageUrls: Partial<Record<"meeting" | "survey", string>> = {};

  try {
    friendUrl = basicId ? buildLineFriendUrl(basicId) : "";
    fallbackMessageUrls = Object.fromEntries(
      ACQUISITION_ROUTES.map((route) => [route.slug, buildLineAcquisitionUrl(basicId, route)])
    );
  } catch {
    friendUrl = "";
    fallbackMessageUrls = {};
  }

  return (
    <LiffAcquisitionClient
      liffId={env.NEXT_PUBLIC_LIFF_ID || ""}
      friendUrl={friendUrl}
      fallbackMessageUrls={fallbackMessageUrls}
    />
  );
}
