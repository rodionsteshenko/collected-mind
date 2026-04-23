import clsx from "clsx";

type Props = {
  children: React.ReactNode;
  tone?: "zinc" | "indigo" | "amber" | "rose" | "emerald" | "violet";
  className?: string;
};

const TONES: Record<NonNullable<Props["tone"]>, string> = {
  zinc: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
  indigo: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200",
  amber: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  rose: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
  emerald: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  violet: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
};

export function Badge({ children, tone = "zinc", className }: Props) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
