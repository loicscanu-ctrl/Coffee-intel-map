"use client";
/**
 * Report wrappers for the Certified Stocks sub-sections. Each renders the real
 * CertifiedStocksPanel in a single-section mode (it self-fetches and uses the
 * default unit/month-to-date window), so the briefing tracks the Demand tab.
 */
import CertifiedStocksPanel from "@/components/demand/CertifiedStocksPanel";

export const CertifiedStocksActivity      = () => <CertifiedStocksPanel section="activity" />;
export const CertifiedStocksFlow          = () => <CertifiedStocksPanel section="flow" />;
export const CertifiedStocksPeriodArabica = () => <CertifiedStocksPanel section="period_arabica" />;
export const CertifiedStocksPeriodRobusta = () => <CertifiedStocksPanel section="period_robusta" />;
