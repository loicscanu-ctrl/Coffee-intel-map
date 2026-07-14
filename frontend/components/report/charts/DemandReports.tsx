"use client";
/**
 * Report wrappers for the Demand "imports by origin" panels. ImportsByOrigin
 * self-fetches its `src`, so these just pin the US / EU sources and headings —
 * mirroring the Demand → Imports tab. (seedKey is omitted: it only drives the
 * tab's API-key prompt, irrelevant in a report.)
 */
import ImportsByOrigin from "@/components/demand/ImportsByOrigin";

export function UsImportsByOrigin() {
  return (
    <ImportsByOrigin
      src="/data/us_coffee_imports.json"
      heading="US Coffee Imports by Origin"
      blurb="Where the US sources its coffee (USITC DataWeb, HTS 0901)"
    />
  );
}

export function EuImportsByOrigin() {
  return (
    <ImportsByOrigin
      src="/data/eu_coffee_imports.json"
      heading="EU Coffee Imports by Origin"
      blurb="Extra-EU coffee sourcing (Eurostat Comext ds-045409, HS 0901)"
    />
  );
}
