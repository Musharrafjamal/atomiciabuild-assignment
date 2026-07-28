import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";

/** Send people to the screen that matches their role. */
export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");
  redirect(session.role === "manager" ? "/dashboard" : "/shifts");
}
