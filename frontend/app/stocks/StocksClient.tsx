"use client";
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

interface StockData { date: string; value: number; }
interface NewsItem { id: number; title: string; body: string; source: string; category: string; tags: string[]; pub_date: string; }
interface Props { stocks: StockData[]; news: NewsItem[]; }

export default function StocksClient({ stocks, news }: Props) {
  return (
    <div className="flex flex-col h-full">
      <div className="h-1/2 p-4 border-b border-slate-700 bg-slate-900/50">
        <h2 className="text-lg font-bold mb-4 text-slate-200">ICE Certified Stocks</h2>
        <ResponsiveContainer width="100%" height="85%">
          <BarChart data={stocks}>
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
          initialItems={news}
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
