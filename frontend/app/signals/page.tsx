import { redirect } from "next/navigation";

// The Signals content (ML price-direction, robusta regression, Vietnam
// differential, news sentiment + calibration) now lives inside the Macro tab.
// Keep this route as a redirect so old links/bookmarks still resolve.
export default function SignalsPage() {
  redirect("/macro");
}
