import type { Metadata } from "next";
import { LegalPage, legalHtml } from "@/components/legal/legal-page";

export const dynamic = "force-static";
export const metadata: Metadata = { title: { absolute: legalHtml("encargo-tratamiento").title }, robots: { index: true } };

export default function Page() {
  return <LegalPage doc="encargo-tratamiento" />;
}
