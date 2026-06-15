"use client";
import { useEffect, useState } from "react";

// Shared fetch-JSON hook with AbortController cleanup. Replaces ~10 ad-hoc
// `useEffect(() => { fetch(...).then(setState).catch(...) }, [])` blocks
// scattered across pages — those had no abort signal, so a fast unmount /
// route change while the fetch was in-flight resolved into a setState call
// on a dead component (React swallows the warning these days but the
// stale-state hazard remains).
//
// Pass null to skip the fetch (e.g. behind a feature flag); the hook resets
// state and never issues a network call.

export interface FetchState<T> {
  data:    T | null;
  loading: boolean;
  error:   Error | null;
}

export function useFetchJson<T = unknown>(path: string | null): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({ data: null, loading: path != null, error: null });

  useEffect(() => {
    if (path == null) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const ctrl = new AbortController();
    setState(s => ({ ...s, loading: true, error: null }));
    fetch(path, { signal: ctrl.signal })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}`);
        return r.json() as Promise<T>;
      })
      .then(data => setState({ data, loading: false, error: null }))
      .catch((err: unknown) => {
        // AbortError is the cleanup path, not a real failure — ignore.
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState({
          data:    null,
          loading: false,
          error:   err instanceof Error ? err : new Error(String(err)),
        });
      });

    return () => ctrl.abort();
  }, [path]);

  return state;
}
