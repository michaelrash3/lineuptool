// ... existing code ...
    // BIG GAME: strong players get a meaningful boost toward premium positions
    // and a penalty for OF spots.
    if (isBigGame) {
      const overall = +p.profile?.overallScore || 0;
      const skill = Math.min(Math.max(overall / 100, 0), 1);
      if (isPremium) {
        score -= skill * 20 - 5;
      } else if (OF_POSITIONS.has(pos)) {
        score += skill * 12 - 6;
      }
    }

    if (score < bestScore) {
      bestScore = score;
      bestPlayer = p;
    }
  }

  return bestPlayer;
}