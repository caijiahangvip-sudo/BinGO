import { describe, expect, it } from 'vitest';

import { getTextStyle } from '@/components/slide-renderer/components/element/TableElement/tableUtils';

describe('table element utilities', () => {
  it('centers table cell text by default', () => {
    expect(getTextStyle()).toMatchObject({ textAlign: 'center' });
    expect(getTextStyle({})).toMatchObject({ textAlign: 'center' });
  });

  it('preserves explicit cell text alignment', () => {
    expect(getTextStyle({ align: 'left' })).toMatchObject({ textAlign: 'left' });
    expect(getTextStyle({ align: 'right' })).toMatchObject({ textAlign: 'right' });
  });
});
