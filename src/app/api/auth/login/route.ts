import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { COLLECTIONS, toPublicUser, type UserDoc } from "@/lib/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { setSessionCookie } from "@/lib/auth/session";
import { handler, ok, readJson } from "@/lib/api/respond";
import { ApiError } from "@/lib/errors";

const loginSchema = z.object({
  email: z.string().min(1, "Email is required"),
  password: z.string().min(1, "Password is required"),
});

export const POST = handler(async (request: Request) => {
  const { email, password } = await readJson(request, loginSchema);

  const db = await getDb();
  const user = await db
    .collection<UserDoc>(COLLECTIONS.users)
    .findOne({ email: email.trim().toLowerCase() });

  // One message for "no such account" and "wrong password" so the response
  // cannot be used to enumerate which addresses exist. The bcrypt comparison
  // still runs against a dummy hash when the user is missing, so the two paths
  // take a similar amount of time.
  const DUMMY = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY);

  if (!user || !valid) {
    throw new ApiError(
      "UNAUTHENTICATED",
      "That email and password do not match an account.",
      401,
    );
  }

  const publicUser = toPublicUser(user);
  await setSessionCookie({
    userId: publicUser.id,
    name: publicUser.name,
    email: publicUser.email,
    role: publicUser.role,
    profession: publicUser.profession,
  });

  return ok({ user: publicUser });
});
