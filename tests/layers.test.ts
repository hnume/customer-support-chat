import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLayers } from '../scripts/check-layers';

test('ไม่มีการ import ย้อน layer', () => {
  assert.deepEqual(checkLayers(), []);
});
