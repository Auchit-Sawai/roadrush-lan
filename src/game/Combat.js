import { BIKE, triggerCrash } from './Physics.js';

// Lateral is positive towards the rider's left. side = +1 punches left, -1 punches right.
export const COMBAT = Object.freeze({
  reach: 2.8,
  minSide: 0.3,
  maxSide: 2.6,
  cooldown: 0.5,
  damage: 24,
  copDamage: 15,
  playerVsCopDamage: 34,
  shove: 1.15,
  speedKeep: 0.9,
  recoverHealth: 55,
});

export const DIFFICULTY = Object.freeze({
  rookie: { label: 'Rookie', speed: 0.9, rubber: 0.55, aggression: 0.35, damage: 0.6 },
  pro: { label: 'Pro', speed: 1.0, rubber: 1.0, aggression: 0.7, damage: 1.0 },
  legend: { label: 'Legend', speed: 1.07, rubber: 1.25, aggression: 1.0, damage: 1.25 },
});

export function difficultyFor(id) {
  return DIFFICULTY[id] ?? DIFFICULTY.pro;
}

export function findTarget(attacker, side, candidates) {
  let best = null;
  let bestScore = Infinity;
  for (const other of candidates) {
    if (other === attacker || other.crashTimer > 0 || other.finished) continue;
    const dp = Math.abs(other.progress - attacker.progress);
    const dl = (other.lateral - attacker.lateral) * side;
    if (dp > COMBAT.reach || dl < COMBAT.minSide || dl > COMBAT.maxSide) continue;
    const score = dp + dl * 0.3;
    if (score < bestScore) {
      best = other;
      bestScore = score;
    }
  }
  return best;
}

export function canPunch(state) {
  return state.punchCooldown <= 0 && state.crashTimer <= 0 && !state.finished;
}

/**
 * Throw a punch. Returns { thrown, hit, ko }. A rider that is invulnerable (just recovered
 * from a crash) can be swung at but takes no damage, so nobody gets chain-knocked-off.
 */
export function punch(attacker, side, candidates, options = {}) {
  if (!canPunch(attacker)) return { thrown: false, hit: null, ko: false };
  attacker.punchCooldown = COMBAT.cooldown;
  attacker.punchSide = side;
  attacker.punchAnim = 1;

  const victim = findTarget(attacker, side, candidates);
  if (!victim || victim.invuln > 0) return { thrown: true, hit: null, ko: false };

  const base = attacker.isCop ? COMBAT.copDamage : victim.isCop ? COMBAT.playerVsCopDamage : COMBAT.damage;
  const damage = (options.damage ?? base) * (options.scale ?? 1);
  victim.health = Math.max(0, victim.health - damage);
  victim.sinceHit = 0;
  victim.hitFlash = 1;
  victim.lateral = Math.max(
    -BIKE.barrierHalfWidth,
    Math.min(BIKE.barrierHalfWidth, victim.lateral + side * COMBAT.shove),
  );
  victim.speed *= COMBAT.speedKeep;

  let ko = false;
  if (victim.health <= 0 && triggerCrash(victim)) {
    ko = true;
    victim.health = COMBAT.recoverHealth;
    if (options.credit !== false) attacker.takedowns += 1;
  }
  return { thrown: true, hit: victim, ko };
}
