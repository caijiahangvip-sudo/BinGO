import { describe, expect, it } from 'vitest';

import { shouldShowTeachingEffects } from '@/lib/playback/effect-visibility';

describe('shouldShowTeachingEffects', () => {
  it('shows teaching effects only during active lecture playback', () => {
    expect(shouldShowTeachingEffects('playing')).toBe(true);
    expect(shouldShowTeachingEffects('idle')).toBe(false);
    expect(shouldShowTeachingEffects('paused')).toBe(false);
    expect(shouldShowTeachingEffects('live')).toBe(false);
  });
});
