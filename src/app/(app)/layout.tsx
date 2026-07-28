import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getSession } from "@/lib/auth/session";

/**
 * Every authenticated screen renders inside this. The session is read on the
 * server, so the shell knows the role before anything paints -- no flash of the
 * wrong navigation while a client-side fetch resolves.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSession();
  if (!user) redirect("/login");

  return <AppShell user={user}>{children}</AppShell>;
}
