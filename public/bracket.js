export const BYE = "BYE";
export const SINGLE = "single";
export const DOUBLE = "double";

export const isPlayer = value => typeof value === "string" && value !== "" && value !== BYE;

export function seedOrder(size) {
  let order = [1, 2];
  while (order.length < size) {
    const sum = order.length * 2 + 1;
    order = order.flatMap(seed => [seed, sum - seed]);
  }
  return order;
}

const fromSeed = seed => ({ seed });
const fromMatch = (id, outcome = "winner") => ({ id, outcome });

function makeSchedule(size, format) {
  const upper = [];
  const lower = [];
  const upperId = (round, index) => "r" + (round + 1) + "m" + (index + 1);
  const lowerId = (round, index) => "l" + (round + 1) + "m" + (index + 1);
  const seeds = seedOrder(size);
  const roundCount = Math.log2(size);

  for (let round = 0; round < roundCount; round++) {
    upper.push(Array.from({ length: size >> (round + 1) }, (_, index) => ({
      id: upperId(round, index),
      sources: [index * 2, index * 2 + 1].map(i =>
        round === 0 ? fromSeed(seeds[i]) : fromMatch(upperId(round - 1, i)))
    })));
  }

  if (format === DOUBLE) {
    lower.push(Array.from({ length: size / 4 }, (_, index) => ({
      id: lowerId(0, index),
      sources: [index * 2, index * 2 + 1].map(i => fromMatch(upperId(0, i), "loser"))
    })));

    for (let round = 1; round < roundCount; round++) {
      const count = size >> (round + 1);
      if (round > 1) {
        const lowerRound = lower.length;
        lower.push(Array.from({ length: count }, (_, index) => ({
          id: lowerId(lowerRound, index),
          sources: [index * 2, index * 2 + 1].map(i => fromMatch(lowerId(lowerRound - 1, i)))
        })));
      }

      const lowerRound = lower.length;
      lower.push(Array.from({ length: count }, (_, index) => ({
        id: lowerId(lowerRound, index),
        // Cross into the adjacent group to avoid immediate rematches where possible.
        sources: [
          fromMatch(lowerId(lowerRound - 1, index)),
          fromMatch(upperId(round, count === 1 ? 0 : index ^ 1), "loser")
        ]
      })));
    }
  }

  return { upper, lower };
}

/**
 * Resolve the bracket in dependency order. null is pending, while BYE means
 * that an entrant cannot arrive (a walkover never produces a loser).
 * When correcting a result, previous is the model before the edit. A saved
 * result survives only if the match still has the exact same two entrants.
 */
export function resolveBracket(state, previous) {
  if (state.bracketSize !== 16 && state.bracketSize !== 32) {
    return { upper: [], lower: [], finals: [], matches: new Map(), results: {}, champion: null };
  }

  const schedule = makeSchedule(state.bracketSize, state.format);
  const matches = new Map();
  const results = {};

  const resolveSource = source => ({
    source,
    seed: source.seed ?? null,
    name: source.seed ? (state.slots[source.seed - 1] ?? null) : matches.get(source.id)[source.outcome]
  });

  function resolveMatch({ id, sources }) {
    const [a, b] = sources.map(resolveSource);
    const playable = isPlayer(a.name) && isPlayer(b.name) && a.name !== b.name;
    let winner = null;
    let loser = null;
    if (a.name === BYE || b.name === BYE) {
      winner = a.name === BYE ? b.name : a.name;
      loser = BYE;
    } else if (playable) {
      const saved = state.results[id];
      const old = previous?.matches.get(id);
      const sameEntrants = !previous || (old?.a.name === a.name && old?.b.name === b.name);
      if (sameEntrants && (saved === a.name || saved === b.name)) {
        winner = saved;
        loser = winner === a.name ? b.name : a.name;
        results[id] = winner;
      }
    }
    const match = { id, a, b, playable, winner, loser };
    matches.set(id, match);
    return match;
  }

  const upper = schedule.upper.map(round => round.map(resolveMatch));
  const lower = schedule.lower.map(round => round.map(resolveMatch));
  const upperFinal = upper.at(-1)[0];
  const finals = [];
  let champion = null;
  if (state.format === DOUBLE) {
    const lowerFinal = lower.at(-1)[0];
    const sources = [fromMatch(upperFinal.id), fromMatch(lowerFinal.id)];
    const final = resolveMatch({ id: "gf1", sources });
    finals.push(final);
    if (isPlayer(final.winner)) {
      if (final.winner === final.b.name) {
        const reset = resolveMatch({ id: "gf2", sources });
        finals.push(reset);
        champion = reset.winner;
      } else {
        champion = final.winner;
      }
    }
  } else if (isPlayer(upperFinal.winner)) {
    champion = upperFinal.winner;
  }

  return { upper, lower, finals, matches, results, champion };
}
