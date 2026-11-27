import assert from "node:assert/strict";
import test from "node:test";
import { BYE, DOUBLE, SINGLE, isPlayer, resolveBracket } from "../public/bracket.js";

function newState(count, format = DOUBLE, filled = true) {
  const bracketSize = count <= 16 ? 16 : 32;
  return {
    format, bracketSize, participantCount: count, results: {},
    slots: Array.from({ length: bracketSize }, (_, i) => i < count ? (filled ? "P" + (i + 1) : null) : BYE)
  };
}

function resolveToFinal(state, choose = () => 0) {
  const losses = new Map(state.slots.filter(isPlayer).map(name => [name, 0]));
  let model = resolveBracket(state);
  while (true) {
    const ready = [...model.upper.flat(), ...model.lower.flat()].filter(m => m.playable && !m.winner);
    if (!ready.length) break;
    const index = choose(ready.length);
    const match = ready[index];
    const [winner, loser] = choose(2) === 0 ? [match.a.name, match.b.name] : [match.b.name, match.a.name];
    if (match.id.startsWith("r")) {
      assert.equal(losses.get(winner), 0);
      assert.equal(losses.get(loser), 0);
    } else {
      assert.equal(losses.get(winner), 1);
      assert.equal(losses.get(loser), 1);
    }
    losses.set(loser, losses.get(loser) + 1);
    state.results[match.id] = winner;
    model = resolveBracket(state);
  }
  return { model, losses };
}

test("全人数で、さまざまな試合順でも両決勝ルートが2敗で敗退になる", () => {
  let seed = 3855;
  const choose = n => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return (seed >>> 12) % n;
  };
  for (let count = 12; count <= 32; count++) {
    for (let i = 0; i < 8; i++) {
      const state = newState(count);
      const { model, losses } = resolveToFinal(state, choose);
      const final = model.finals[0];
      assert.ok(final.playable, count + "人");
      assert.equal(losses.get(final.a.name), 0);
      assert.equal(losses.get(final.b.name), 1);
      assert.equal(Object.keys(model.results).length, 2 * count - 3);
      assert.equal(model.finals.length, 1);
      assert.equal(model.champion, null);
      for (const [player, lossCount] of losses) {
        if (player !== final.a.name && player !== final.b.name) assert.equal(lossCount, 2);
      }

      state.results.gf1 = final.a.name;
      const upperWin = resolveBracket(state);
      assert.equal(upperWin.champion, final.a.name);
      assert.equal(upperWin.finals.length, 1);
      assert.equal(Object.keys(upperWin.results).length, 2 * count - 2);

      state.results.gf1 = final.b.name;
      const firstLowerWin = resolveBracket(state);
      const reset = firstLowerWin.finals[1];
      assert.equal(firstLowerWin.champion, null);
      assert.ok(reset.playable);
      assert.deepEqual([reset.a.name, reset.b.name], [final.a.name, final.b.name]);
      state.results.gf2 = i % 2 === 0 ? reset.a.name : reset.b.name;
      const doubleFinal = resolveBracket(state);
      assert.equal(doubleFinal.champion, state.results.gf2);
      assert.equal(Object.keys(doubleFinal.results).length, 2 * count - 1);
    }
  }
});

test("BYEと未登録、未確定の敗者を区別する", () => {
  const state = newState(17, DOUBLE, false);
  let model = resolveBracket(state);
  const bye = model.matches.get("r1m1");
  assert.equal(bye.a.name, null);
  assert.equal(bye.b.name, BYE);
  assert.equal(bye.winner, null);
  assert.equal(bye.loser, BYE);
  const actualFirst = model.upper[0].find(match => match.b.name !== BYE);
  const destination = model.lower[0].find(match =>
    [match.a, match.b].some(p => p.source.id === actualFirst.id));
  assert.ok(destination);
  assert.equal(actualFirst.loser, null);
  assert.equal(destination.winner, null);

  for (const { seed } of [actualFirst.a, actualFirst.b]) state.slots[seed - 1] = "P" + seed;
  state.results[actualFirst.id] = "P" + actualFirst.a.seed;
  model = resolveBracket(state);
  assert.equal(model.matches.get(destination.id).winner, "P" + actualFirst.b.seed);
  assert.equal(model.matches.get(destination.id).loser, BYE);
});

test("勝者敗者を別々の後続枠に送り、2回戦の降格先を交差させる", () => {
  const state = newState(16);
  state.results.r1m1 = "P1";
  const model = resolveBracket(state);
  assert.equal(model.matches.get("r2m1").a.name, "P1");
  assert.equal(model.matches.get("l1m1").a.name, "P16");
  assert.equal(model.matches.get("l1m1").b.name, null);
  assert.equal(model.matches.get("l1m1").playable, false);
  assert.deepEqual(model.matches.get("l2m1").b.source, { id: "r2m2", outcome: "loser" });
  assert.deepEqual(model.matches.get("l2m2").b.source, { id: "r2m1", outcome: "loser" });
});

test("訂正は勝者側・敗者側・決勝の関係する結果にだけ反映される", () => {
  const state = newState(16);
  resolveToFinal(state);
  state.results.gf1 = resolveBracket(state).finals[0].b.name;
  state.results.gf2 = resolveBracket(state).finals[1].a.name;
  const previous = resolveBracket(state);
  const first = previous.matches.get("r1m1");
  assert.equal(previous.results.r2m1, first.winner);
  assert.ok(previous.results.l1m1);
  state.results.r1m1 = first.loser;
  const corrected = resolveBracket(state, previous);
  assert.equal(corrected.results.r1m1, first.loser);
  assert.equal(corrected.results.r2m1, undefined);
  assert.equal(corrected.results.l1m1, undefined);
  assert.equal(corrected.results.gf1, undefined);
  assert.equal(corrected.results.gf2, undefined);
  assert.equal(corrected.results.r2m4, previous.results.r2m4);
  assert.equal(corrected.results.l1m4, previous.results.l1m4);
  assert.equal(corrected.champion, null);
});

test("決勝の訂正で第2試合が不要になれば結果も消える", () => {
  const state = newState(12);
  resolveToFinal(state);
  const final = resolveBracket(state).finals[0];
  state.results.gf1 = final.b.name;
  state.results.gf2 = final.b.name;
  const previous = resolveBracket(state);
  state.results.gf1 = final.a.name;
  const model = resolveBracket(state, previous);
  assert.equal(model.finals.length, 1);
  assert.equal(model.results.gf2, undefined);
  assert.equal(model.champion, final.a.name);
});

test("旧形式の保存済みデータをシングルとして維持する", () => {
  for (let count = 12; count <= 32; count++) {
    const state = newState(count, SINGLE);
    delete state.format;
    const { model } = resolveToFinal(state);
    assert.equal(model.champion, "P1");
    assert.equal(model.lower.length, 0);
    assert.equal(model.finals.length, 0);
    assert.equal(Object.keys(model.results).length, count - 1);
    assert.deepEqual(model.results, state.results);
  }
});
