"use client";
/**
 * ENSO was previously its own top-level tab; it now lives inside
 * /supply (next to Fertilizers). Anything bookmarked at /enso still
 * lands users on the right view via this client-side redirect.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function EnsoRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/supply?origin=enso");
  }, [router]);
  return (
    <div className="min-h-screen bg-slate-950 text-slate-500 flex items-center justify-center text-xs">
      Redirecting to /supply?origin=enso…
    </div>
  );
}
