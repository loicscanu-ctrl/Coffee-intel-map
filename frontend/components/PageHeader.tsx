import { DataHealthBar } from "./DataHealthBar";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  healthKeys?: string[];
  rightSlot?: React.ReactNode;
}

export default function PageHeader({ title, subtitle, healthKeys, rightSlot }: PageHeaderProps) {
  const hasRightSide = Boolean(rightSlot) || Boolean(healthKeys?.length);
  return (
    <div className="border-b border-slate-800 bg-slate-950 px-4 sm:px-6 py-3 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-base sm:text-xl font-bold text-white truncate">{title}</h1>
        {subtitle && (
          <p className="hidden sm:block text-xs text-slate-400 mt-0.5">{subtitle}</p>
        )}
      </div>
      {hasRightSide && (
        <div className="flex items-center gap-3 flex-wrap justify-end">
          {rightSlot}
          {healthKeys && healthKeys.length > 0 && <DataHealthBar keys={healthKeys} />}
        </div>
      )}
    </div>
  );
}
