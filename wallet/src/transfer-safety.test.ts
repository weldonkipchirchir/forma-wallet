import { describe, it, expect } from 'vitest';
import { assertFreshReview, recipientNotice, safeTokenText } from './transfer-safety';
import { tokenAmount } from './token-data';
import { transferInput } from './wallet';

const own = '0x' + '1'.repeat(40);
const previous = '0xabcd' + '1'.repeat(32) + '1234';
const lookalike = '0xabcd' + '2'.repeat(32) + '1234';
describe('review and recipient protections', () => {
  it('rejects expired and future-dated reviews', () => {
    expect(() => assertFreshReview(1000, 121000)).not.toThrow();
    expect(() => assertFreshReview(1000, 121001)).toThrow('expired');
    expect(() => assertFreshReview(1000, 999)).toThrow('expired');
  });
  it('blocks lookalike addresses while recognizing full exact matches', () => {
    expect(() => recipientNotice(lookalike, own, [previous])).toThrow('lookalike');
    expect(recipientNotice(previous, own, [previous])).toContain('Previously');
    expect(recipientNotice('0x' + '3'.repeat(40), own, [previous])).toContain('First-time');
    expect(recipientNotice(own, own, [])).toContain('own wallet');
  });
  it('rejects zero-address sends and deceptive direction-control metadata', () => {
    expect(() => recipientNotice('0x' + '0'.repeat(40), own, [])).toThrow();
    expect(safeTokenText('USD\u202eSC', 20)).toBe(false);
    expect(safeTokenText('TEST\u0000', 20)).toBe(false);
    expect(safeTokenText('USDC', 20)).toBe(true);
  });
  it('bounds untrusted numeric input before unit conversion', () => {
    expect(() => tokenAmount('1'.repeat(10000), 18)).toThrow('too long');
    expect(() => transferInput(own, '1'.repeat(10000))).toThrow('too long');
  });
});
