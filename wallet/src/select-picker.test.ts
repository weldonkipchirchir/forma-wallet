import { describe, expect, it } from 'vitest';
import { movePickerOption, searchPickerOptions } from './select-picker';
const options = [{ value: 'eth', label: 'Ethereum Sepolia', disabled: false, index: 0 }, { value: 'sol', label: 'Solana Devnet', disabled: true, index: 1 }, { value: 'tron', label: 'TRON Nile', disabled: false, index: 2 }];
describe('searchable select options', () => {
  it('searches names and values without mutating source options', () => {
    expect(searchPickerOptions(options, ' nile ')).toEqual([options[2]]);
    expect(searchPickerOptions(options, 'ETH')).toEqual([options[0]]);
    expect(searchPickerOptions(options, 'missing')).toEqual([]); expect(options).toHaveLength(3);
  });
  it('skips disabled choices and wraps keyboard navigation', () => {
    expect(movePickerOption(options, 0, 1)).toBe(2); expect(movePickerOption(options, 2, 1)).toBe(0);
    expect(movePickerOption(options, 0, -1)).toBe(2); expect(movePickerOption(options.map(option => ({ ...option, disabled: true })), 0, 1)).toBe(-1);
  });
  it('bounds large option lists while retaining filtered matches', () => {
    const many = Array.from({ length: 250 }, (_, index) => ({ value: String(index), label: `Token ${index}`, disabled: false, index }));
    expect(searchPickerOptions(many, '')).toHaveLength(100); expect(searchPickerOptions(many, '249')[0].value).toBe('249');
  });
});
