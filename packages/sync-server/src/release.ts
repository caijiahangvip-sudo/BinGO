import { config } from './config.js';

export const RELEASE_CITIES = Object.freeze([
  'Rome', 'Ostia', 'Pompeii', 'Carthago', 'Londinium', 'Tarraco', 'Mediolanum', 'Constantinopolis',
]);

export function releaseMetadata() {
  return {
    version: config.BINGO_RELEASE_VERSION,
    codename: config.BINGO_RELEASE_CODENAME,
    modelProfile: config.BINGO_MODEL_PROFILE,
    releaseSequence: RELEASE_CITIES.indexOf(config.BINGO_RELEASE_CODENAME) + 1 || null,
  };
}
