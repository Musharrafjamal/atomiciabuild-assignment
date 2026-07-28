"use client";

import useSWR, { mutate as globalMutate } from "swr";
import type { ShiftView, StaffView } from "@/lib/api/views";

/**
 * Client data access.
 *
 * The server returns rule rejections as `{ error: { code, message } }` with a 4xx.
 * `ApiFailure` carries both through, so a component can show the exact sentence
 * the rules engine produced -- "This overlaps a shift already claimed on
 * 2026-08-17 22:00-06:00" -- instead of a generic failure.
 */

export class ApiFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body
      ? { "Content-Type": "application/json", ...init?.headers }
      : init?.headers,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiFailure(
      data?.error?.code ?? "INTERNAL",
      data?.error?.message ?? "Something went wrong.",
      response.status,
    );
  }
  return data as T;
}

export const api = {
  get: <T,>(url: string) => request<T>(url),
  post: <T,>(url: string, body?: unknown) =>
    request<T>(url, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T,>(url: string, body: unknown) =>
    request<T>(url, { method: "PATCH", body: JSON.stringify(body) }),
  del: <T,>(url: string, body?: unknown) =>
    request<T>(url, { method: "DELETE", body: body ? JSON.stringify(body) : undefined }),
};

export interface WeekResponse {
  week: string;
  days: string[];
  shifts: ShiftView[];
  /** Set only when this week is empty: the nearest week that has shifts. */
  nearestWeek: string | null;
}

export function weekKey(week: string) {
  return `/api/shifts?week=${week}`;
}

export function useWeek(week: string) {
  return useSWR<WeekResponse>(weekKey(week), api.get, {
    keepPreviousData: true,
    revalidateOnFocus: true,
  });
}

export function useStaff(enabled: boolean) {
  return useSWR<{ staff: StaffView[] }>(enabled ? "/api/staff" : null, api.get);
}

/** Re-fetch a week after a mutation, without a full page navigation. */
export function refreshWeek(week: string) {
  return globalMutate(weekKey(week));
}
