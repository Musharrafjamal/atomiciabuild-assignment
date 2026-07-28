import { z } from "zod";
import { ObjectId } from "mongodb";
import { handler, ok, readJson } from "@/lib/api/respond";
import { toShiftView } from "@/lib/api/views";
import {
  findNearestWeekWithShifts,
  findShiftsForWeek,
} from "@/lib/api/shift-queries";
import { requireManager, requireUser } from "@/lib/auth/guards";
import { createShift } from "@/lib/rules/shifts";
import { clinicToday, weekDayKeys } from "@/lib/time";
import { invalidInput } from "@/lib/errors";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** GET /api/shifts?week=YYYY-MM-DD — every shift in that clinic-local week. */
export const GET = handler(async (request: Request) => {
  const session = await requireUser();
  const url = new URL(request.url);
  const week = url.searchParams.get("week") ?? clinicToday();

  if (!ISO_DATE.test(week)) {
    throw invalidInput("week must be a YYYY-MM-DD date.");
  }

  const shifts = await findShiftsForWeek(week);
  const viewerId = new ObjectId(session.userId);

  return ok({
    week,
    days: weekDayKeys(week),
    shifts: shifts.map((s) => toShiftView(s, viewerId)),
    // Only looked up when the week is empty, so the common path stays one query.
    nearestWeek: shifts.length === 0 ? await findNearestWeekWithShifts(week) : null,
  });
});

const staffCountSchema = z
  .object({
    doctor: z.number().int().min(0).max(50).optional(),
    nurse: z.number().int().min(0).max(50).optional(),
    receptionist: z.number().int().min(0).max(50).optional(),
  })
  .default({});

const createSchema = z.object({
  date: z.string().regex(ISO_DATE, "Date must be YYYY-MM-DD"),
  startTime: z.string(),
  endTime: z.string(),
  requirements: staffCountSchema,
});

/** POST /api/shifts — managers only. */
export const POST = handler(async (request: Request) => {
  await requireManager();
  const input = await readJson(request, createSchema);
  const shift = await createShift(input);
  return ok({ shift: toShiftView(shift) }, 201);
});
