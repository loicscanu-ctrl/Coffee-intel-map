"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/futures", label: "Futures Exchange" },
  { href: "/freight", label: "Freight" },
  { href: "/stocks", label: "Stocks" },
  { href: "/supply", label: "Supply" },
  { href: "/demand", label: "Demand" },
  { href: "/macro", label: "Macro" },
  { href: "/map", label: "News & Intel" },
];

export default function TabNav() {
  const pathname = usePathname();
  return (
    <nav className="flex border-b border-slate-700 bg-slate-900 px-4">
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              active
                ? "border-indigo-500 text-white"
                : "border-transparent text-slate-400 hover:text-white"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
