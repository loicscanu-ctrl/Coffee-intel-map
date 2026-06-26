"use client";
/** Report wrapper for the coffee-news sentiment visual — the net-sentiment gauge
 *  + daily trend, in compact height to fit a half-width briefing slot. */
import SentimentTrend from "@/components/signals/SentimentTrend";

export default function SentimentReport() {
  return <SentimentTrend compact />;
}
