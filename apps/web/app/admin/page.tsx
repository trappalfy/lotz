import type { Metadata } from "next";
import { AdminPage } from "@/components/AdminPage";

export const metadata: Metadata = { title: "Moderation — Lotz", robots: { index: false, follow: false } };

export default function Page() {
  return <AdminPage />;
}
