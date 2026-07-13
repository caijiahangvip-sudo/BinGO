import type { EngineMode } from './types';

export function shouldShowTeachingEffects(engineMode: EngineMode): boolean {
  return engineMode === 'playing';
}
