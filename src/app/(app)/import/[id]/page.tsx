import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { ReportScreen } from "./report-screen";

export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/shifts");

  const { id } = await params;
  return <ReportScreen id={id} />;
}
