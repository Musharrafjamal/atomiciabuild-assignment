import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { clinicToday } from "@/lib/time";
import { DashboardScreen } from "./dashboard-screen";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  // The proxy redirects staff away from here, but that is convenience routing --
  // this check is the one that matters.
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/shifts");

  const { week } = await searchParams;

  return (
    <Suspense>
      <DashboardScreen
        initialWeek={
          week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : clinicToday()
        }
      />
    </Suspense>
  );
}
