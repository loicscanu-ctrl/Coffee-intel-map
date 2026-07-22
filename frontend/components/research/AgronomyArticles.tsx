"use client";
// Agronomy explainer articles. Each article (text + its own diagrams/charts)
// lives in its own file under ./agronomy; this is just the layout shell.
import Article1 from "./agronomy/Article1";
import Article2 from "./agronomy/Article2";
import Article3 from "./agronomy/Article3";
import Article4 from "./agronomy/Article4";
import Article5 from "./agronomy/Article5";

export default function AgronomyArticles() {
  return (
    <div className="space-y-4">
      <Article1 />
      <Article2 />
      <Article3 />
      <Article4 />
      <Article5 />
    </div>
  );
}
