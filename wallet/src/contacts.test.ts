import { describe, it, expect } from 'vitest';
import { contactInput, parseContacts, addContact, contactNotice, contactsKey } from './contacts';
const address = '0xabcd' + '1'.repeat(32) + '1234';
describe('user verified contacts', () => {
  it('requires explicit verification and valid nonzero addresses', () => {
    expect(() => contactInput('Alice', address, false)).toThrow('Confirm');
    expect(() => contactInput('Alice', '0x' + '0'.repeat(40), true)).toThrow('zero');
    expect(() => contactInput('Alice', 'alice.eth', true)).toThrow();
  });
  it('rejects deceptive names, duplicates and excessive lists', () => {
    expect(() => contactInput('USD\u202e', address, true)).toThrow();
    expect(() => contactInput('x'.repeat(41), address, true)).toThrow();
    const alice = contactInput('Alice', address, true);
    expect(() => addContact([alice], alice)).toThrow('already saved');
    expect(() => addContact([alice], contactInput('alice', '0x' + '2'.repeat(40), true))).toThrow();
    expect(() => addContact(Array(100).fill(alice), alice)).toThrow('100');
  });
  it('recognizes exact contacts and blocks shortened-address lookalikes', () => {
    const rows = [contactInput('Alice', address, true)];
    expect(contactNotice(address, rows)).toContain('Saved contact: Alice');
    expect(() => contactNotice('0xabcd' + '2'.repeat(32) + '1234', rows)).toThrow('lookalike');
    expect(contactNotice('0x' + '4'.repeat(40), rows)).toBe('');
  });
  it('rejects corrupt stored contacts and scopes lists by wallet', () => {
    const alice = contactInput('Alice', address, true);
    expect(parseContacts([alice, alice, { ...alice, verifiedAt: 'bad' }, { ...alice, address: '<script>' }])).toEqual([alice]);
    expect(parseContacts({})).toEqual([]);
    expect(contactsKey(address)).not.toBe(contactsKey('0x' + '2'.repeat(40)));
  });
});
