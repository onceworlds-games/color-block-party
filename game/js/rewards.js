// What a race is worth to the player: experience, points, medals, badges, the boards and a personal-best ghost.
// Applied once per race (keyed by the race's id), so a reload can't count it twice.

import { platform } from './platform.js';
import { raceReward, levelOf, medalFor, packGhost } from './progress.js';

const SIX = ['light', 'moderate', 'fresh', 'shifty', 'squall', 'fog'];

/**
 * r: { key, place, fleet, finished, time, b (my boat), rules, weather, courseId, trial, secondTime, ghostPts,
 *      oldGhost (unpacked or null) }
 * Returns { reward, levelUp, level, medal, badges: [ids], pb }.
 */
export function applyRace(profile, r) {
  if (profile.lastRace === r.key) return null;
  profile.lastRace = r.key;
  const b = r.b;
  const st = b?.stats ?? { clean: 0, steals: {}, fouls: 0, ocs: 0, gustT: 0 };
  const steals = Object.keys(st.steals ?? {}).length;
  const perfectStart = !!b && b.startT !== null && b.startT <= 0.5 && b.startV >= 0.9;
  const medal = r.trial && r.finished ? medalFor(r.courseId, r.time) : 0;
  const before = levelOf(profile.xp);
  const reward = raceReward({ place: r.place, fleet: r.fleet, cleanTacks: st.clean, steals, perfectStart, medal, finished: r.finished });
  profile.xp += reward.xp;
  profile.points += reward.points;
  profile.races += 1;
  if (r.finished && r.place === 1 && r.fleet > 1) profile.wins += 1;
  if (r.weather && SIX.includes(r.weather)) profile.weathers[r.weather] = true;
  profile.stats.cleanTacks += st.clean;
  profile.stats.steals += steals;
  if (perfectStart) profile.stats.starts += 1;
  const level = levelOf(profile.xp);
  const badges = [];
  const earn = (id, cond) => {
    if (cond) badges.push(id);
  };
  earn('first-race', r.finished);
  earn('clean-tack', st.clean >= 10);
  earn('wind-thief', steals >= 3);
  earn('photo-finish', r.finished && r.place === 1 && Number.isFinite(r.secondTime) && r.secondTime - r.time < 0.5);
  earn('perfect-start', perfectStart);
  earn('no-fouls', r.finished && r.rules === 'racing' && st.fouls === 0 && st.ocs === 0);
  earn('gust-rider', st.gustT >= 60);
  earn('every-weather', SIX.every((w) => profile.weathers[w]));
  earn('captain', level >= 10);
  let pb = false;
  if (r.trial && r.finished) {
    if (medal) profile.medals[r.courseId] = Math.max(profile.medals[r.courseId] ?? 0, medal);
    earn('par-excellence', medal === 3);
    const prev = profile.best[r.courseId];
    if (!prev || r.time < prev) {
      pb = true;
      profile.best[r.courseId] = r.time;
      earn('ghost-buster', !!r.oldGhost && r.time < r.oldGhost.t);
      const g = packGhost(r.ghostPts ?? [], r.time, b?.cls ?? 'dinghy');
      if (g) platform.save(`ghost-${r.courseId}`, g);
    }
    platform.submit(`course-${r.courseId}`, Math.round(r.time * 1000) / 1000, true);
  } else if (r.fleet > 1) {
    if (r.finished && r.place === 1) platform.submit('fleet-wins', profile.wins);
    platform.submit('fleet-points', profile.points);
  }
  for (const id of badges) awardOnce(profile, id);
  return { reward, levelUp: level > before, level, medal, badges, pb };
}

/** Awards a badge the first time (the platform ignores repeats; this saves the call). */
export function awardOnce(profile, id) {
  if (profile.badges[id]) return;
  profile.badges[id] = true;
  platform.award(id);
}
