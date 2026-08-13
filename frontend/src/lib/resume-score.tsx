import { Star } from "lucide-react";

/** 0-100 AI score -> 0-5 stars (matches the student resume page). */
export function scoreToStars(score: number | null): number {
  if (score == null) return 0;
  return Math.min(5, Math.max(0, Math.round(score / 10) / 2));
}

export function scoreTone(score: number | null) {
  if (score == null) return "text-muted-foreground";
  if (score >= 70) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 45) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

export function StarRating({ score }: { score: number | null }) {
  const stars = scoreToStars(score);
  return (
    <div className="flex items-center gap-0.5" aria-label={`${stars} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const filled = stars >= i;
        const half = !filled && stars >= i - 0.5;
        return (
          <Star
            key={i}
            className={
              filled
                ? "size-4 fill-amber-400 text-amber-400"
                : half
                  ? "size-4 fill-amber-400/40 text-amber-400"
                  : "size-4 text-muted-foreground/40"
            }
          />
        );
      })}
      <span className="ml-1.5 text-xs font-semibold tabular-nums">{stars.toFixed(1)}</span>
    </div>
  );
}
