"use client";

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * The selected week, held in state and mirrored into `?week=YYYY-MM-DD`.
 *
 * Keeping it in the URL means a week is linkable and survives a refresh -- a
 * manager can send a colleague the exact week that is short-staffed. Routing
 * every change through one setter keeps the address bar and the screen in step.
 */
export function useWeekParam(initial: string): [string, (next: string) => void] {
  const router = useRouter();
  const params = useSearchParams();
  const [week, setWeek] = useState(initial);

  const go = useCallback(
    (next: string) => {
      setWeek(next);
      const query = new URLSearchParams(params.toString());
      query.set("week", next);
      router.replace(`?${query.toString()}`, { scroll: false });
    },
    [params, router],
  );

  return [week, go];
}
