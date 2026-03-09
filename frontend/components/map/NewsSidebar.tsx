interface NewsItem {
  id: number;
  title: string;
  body: string;
  source: string;
  category: string;
  tags: string[];
  pub_date: string;
}

interface Props {
  item: NewsItem | null;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  supply: "Supply / Crop",
  demand: "Demand Signal",
  macro: "Macro",
  general: "General Intel",
};

const CATEGORY_COLORS: Record<string, string> = {
  supply: "border-red-500 text-red-400",
  demand: "border-yellow-500 text-yellow-400",
  macro: "border-blue-500 text-blue-400",
  general: "border-gray-500 text-gray-400",
};

export default function NewsSidebar({ item, onClose }: Props) {
  if (!item) return null;
  const colorClass = CATEGORY_COLORS[item.category] || CATEGORY_COLORS.general;
  return (
    <div className="absolute top-0 right-0 h-full w-80 bg-slate-900/95 border-l border-slate-700 z-[1000] flex flex-col shadow-2xl">
      <div className="flex items-center justify-between p-4 border-b border-slate-700">
        <span className={`text-xs font-bold uppercase border-l-4 pl-2 ${colorClass}`}>
          {CATEGORY_LABELS[item.category] || item.category}
        </span>
        <button onClick={onClose} className="text-slate-400 hover:text-white text-lg leading-none">×</button>
      </div>
      <div className="p-4 overflow-y-auto flex-1">
        <h3 className="font-bold text-white mb-3 leading-snug">{item.title}</h3>
        <p className="text-slate-300 text-sm leading-relaxed mb-4">{item.body}</p>
        <div className="text-xs text-slate-500 space-y-1">
          {item.source && <div>Source: {item.source}</div>}
          {item.pub_date && <div>{new Date(item.pub_date).toLocaleDateString()}</div>}
          {item.tags?.length > 0 && (
            <div className="flex gap-1 flex-wrap mt-2">
              {item.tags.map((tag) => (
                <span key={tag} className="bg-slate-800 px-2 py-0.5 rounded text-slate-400">{tag}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
