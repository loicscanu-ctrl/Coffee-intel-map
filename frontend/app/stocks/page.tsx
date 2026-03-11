"use client";
import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import NewsFeedList from "@/components/NewsFeedList";
import { fetchStocks } from "@/lib/api";

interface StockData {
  date: string;
  value: number;
}

// Fallback data to display if the API is not yet running
const MOCK_DATA: StockData[] = [
  { date: "2023-08", value: 550230 },
  { date: "2023-09", value: 480120 },
  { date: "2023-10", value: 440500 },
  { date: "2023-11", value: 390000 },
  { date: "2023-12", value: 250100 },
  { date: "2024-01", value: 245000 },
  { date: "2024-02", value: 290000 },
];

export default function StocksPage() {
  const [data, setData] = useState<StockData[]>(MOCK_DATA);

  useEffect(() => {
    fetchStocks()
      .then((json) => { if (json.length > 0) setData(json); })
      .catch((err) => console.error("Failed to fetch certified stocks:", err));
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="h-1/2 p-4 border-b border-slate-700 bg-slate-900/50">
        <h2 className="text-lg font-bold mb-4 text-slate-200">ICE Certified Stocks</h2>
        <ResponsiveContainer width="100%" height="85%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
            <XAxis dataKey="date" stroke="#94a3b8" tick={{ fontSize: 12 }} />
            <YAxis stroke="#94a3b8" tick={{ fontSize: 12 }} />
            <Tooltip contentStyle={{ backgroundColor: "#1e293b", borderColor: "#475569" }} itemStyle={{ color: "#e2e8f0" }} />
            <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Bags" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex-1 overflow-hidden">
        <NewsFeedList
          title="Market News & Intel"
          filterFn={(item: any) => {
            const tags = item.tags?.map((t: string) => t.toLowerCase()) || [];
            return (
              tags.includes("stocks") &&
              !tags.includes("demand") &&
              !tags.includes("general")
            );
          }}
        />
      </div>
    </div>
  );
}
