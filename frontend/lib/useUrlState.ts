"use client";
import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function useUrlState<T extends string | number>(
  key: string,
  defaultValue: T,
  parse?: (raw: string) => T,
): [T, (next: T) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const value = useMemo<T>(() => {
    const raw = params.get(key);
    if (raw == null) return defaultValue;
    if (parse) return parse(raw);
    if (typeof defaultValue === "number") {
      const n = Number(raw);
      return (Number.isFinite(n) ? n : defaultValue) as T;
    }
    return raw as T;
  }, [params, key, defaultValue, parse]);

  const setValue = useCallback(
    (next: T) => {
      const sp = new URLSearchParams(params.toString());
      if (next === defaultValue || next === "" || next == null) sp.delete(key);
      else sp.set(key, String(next));
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, params, key, defaultValue],
  );

  return [value, setValue];
}
