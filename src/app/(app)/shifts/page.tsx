import { Suspense } from "react";
import { getSession } from "@/lib/auth/session";
import { clinicToday } from "@/lib/time";
import { ShiftsScreen } from "./shifts-screen";

export default async function ShiftsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;
  const session = await getSession();

  return (
    <Suspense>
      <ShiftsScreen
        initialWeek={week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : clinicToday()}
        viewerId={session!.userId}
        viewerName={session!.name}
        canManage={session!.role === "manager"}
      />
    </Suspense>
  );
}
