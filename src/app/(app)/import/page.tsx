import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { ImportScreen } from "./import-screen";

export default async function ImportPage() {
  // Manager-only. The proxy redirects staff, but this is the check that counts.
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/shifts");

  return <ImportScreen />;
}
