// Throwaway helper added only to demonstrate the automated Claude PR review.
// Safe to delete after the review run.

export interface TeamScore {
  team: string;
  points: number;
}

/** Average points per team, formatted to one decimal place. */
export function averagePoints(scores: TeamScore[]): string {
  const total = scores.reduce((sum, s) => sum + s.points, 0);
  return (total / scores.length).toFixed(1);
}

/** The team with the highest points. */
export function topTeam(scores: TeamScore[]): string {
  return scores.sort((a, b) => b.points - a.points)[0].team;
}
