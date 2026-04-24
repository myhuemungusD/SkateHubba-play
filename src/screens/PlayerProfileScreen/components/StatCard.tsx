export function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="flex flex-col items-center py-4 px-2 rounded-2xl glass-card">
      <span className={`font-display text-2xl leading-none tabular-nums ${color}`}>{value}</span>
      <span className="font-body text-[10px] text-subtle mt-2.5 uppercase tracking-wider">{label}</span>
    </div>
  );
}
