import { fetchStocks, fetchNews } from "@/lib/api";
import StocksClient from "./StocksClient";

const MOCK_DATA = [
  { date: "2023-08", value: 550230 },
  { date: "2023-09", value: 480120 },
  { date: "2023-10", value: 440500 },
  { date: "2023-11", value: 390000 },
  { date: "2023-12", value: 250100 },
  { date: "2024-01", value: 245000 },
  { date: "2024-02", value: 290000 },
];

export default async function StocksPage() {
  const [stocksRaw, news] = await Promise.all([
    fetchStocks().catch((e) => {
      console.error("[stocks] fetchStocks failed", e);
      return [];
    }),
    fetchNews().catch((e) => {
      console.error("[stocks] fetchNews failed", e);
      return [];
    }),
  ]);
  const stocks = stocksRaw.length > 0 ? stocksRaw : MOCK_DATA;
  return <StocksClient stocks={stocks} news={news} />;
}
