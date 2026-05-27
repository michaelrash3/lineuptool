export const TEAM_PLURAL_SUBSTITUTIONS: Record<string, string> = {
  " is ": " are ",
  " has ": " have ",
  " owns ": " own ",
  " ranges ": " range ",
};

// Team names are treated as plural in matchup copy (e.g. "Cruzers have").
export function enforcePluralTeamGrammar(copy: string): string {
  let next = ` ${copy} `;
  for (const [from, to] of Object.entries(TEAM_PLURAL_SUBSTITUTIONS)) {
    next = next.split(from).join(to);
  }
  return next.trim();
}

export function formatSeedOutcome(teamName: string, winSeed: number, lossSeed: number): string {
  if (winSeed === lossSeed) {
    return `${teamName} are currently locked in as the #${winSeed} seed`;
  }
  return `${teamName} range from #${winSeed} with a win to #${lossSeed} with a loss`;
}
