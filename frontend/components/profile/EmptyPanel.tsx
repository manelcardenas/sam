/**
 * The profile's empty state.
 *
 * One component for both flavours — "you have none of these yet" and "your
 * search matched none of them" — because they need identical shape and differ
 * only in words and in what the button does. Keeping them as one stops the
 * two drifting apart, which is exactly what happened on the old page where the
 * recipes empty state was a bare centred sentence and the reviews one had an
 * icon and a call to action.
 */
export function EmptyPanel({
  icon,
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-line bg-surface px-6 py-12 text-center">
      {icon}
      <p className="font-display font-semibold text-fg">{title}</p>
      <p className="mx-auto mt-1 max-w-xs text-balance text-sm text-muted">{body}</p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="mt-5 inline-flex cursor-pointer items-center rounded-full border border-line bg-surface px-4 py-2.5 font-display text-sm font-semibold text-fg transition-colors hover:border-tomato/40 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
