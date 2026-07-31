export function PlaceholderChart({ height = 220 }: { height?: number }) {
  const bars = [40, 52, 48, 60, 72, 65, 78, 74, 86, 82, 88, 76];

  return (
    <div className="rounded-xl bg-surface-container-low p-4 border border-outline-variant/20" style={{ height }}>
      <div className="h-full flex items-end gap-1">
        {bars.map((value, index) => (
          <div key={index} className="flex-1 rounded-t bg-primary/35" style={{ height: `${value}%` }} />
        ))}
      </div>
    </div>
  );
}
