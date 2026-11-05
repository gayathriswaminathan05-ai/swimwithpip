import { PowerCurrent, GhostNet } from './lost.js';
import { OctopusAmbush, Rockfall, PredatorChase, Vents } from './depths.js';
import { DarkCavern, TheLure } from './home.js';

// Journey layout: distance (s) along the route for each hurdle. Three areas:
//   The Lost Waters (0–250): powerful current, abandoned net
//   The Dangerous Depths (250–620): octopus, rockfall, predator, vents
//   The Glowing Home (620–772): the dark cavern opens onto the home reef, then the final ambush.
// Jellyfish appear only as ambient sea life, never as a hurdle.
export const HOME_S = 772;

export function createEncounters(game) {
  return [
    new PowerCurrent(game, { index: 0, s: 72, clearHalfWidth: 11.5 }),
    new GhostNet(game, { index: 1, s: 175, clearHalfWidth: 9 }),
    new OctopusAmbush(game, { index: 2, s: 290, clearHalfWidth: 8 }),
    new Rockfall(game, { index: 3, s: 365, exit: 16, clearHalfWidth: 11 }),
    new PredatorChase(game, { index: 4, s: 440, clearHalfWidth: 10, approachFrom: 24 }),
    new Vents(game, { index: 5, s: 515, clearHalfWidth: 7 }),
    new DarkCavern(game, { index: 6, s: 580, exit: 42, clearHalfWidth: 10 }),
    new TheLure(game, { index: 7, s: 690, stages: 2, clearHalfWidth: 8, approachFrom: 30 }),
  ];
}
