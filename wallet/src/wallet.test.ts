import { describe, it, expect } from 'vitest';
import { Wallet } from 'ethers';
import { affordable, requireSepolia, transferInput, validatePassword, importPhrase } from './wallet';

describe('wallet safety boundaries', () => {
  it('restores a public BIP39 test vector and distinguishes account indexes and passphrases', () => {
    const phrase = 'test test test test test test test test test test test junk';
    expect(importPhrase(phrase).address).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
    expect(importPhrase(phrase, '', 1).address).not.toBe(importPhrase(phrase).address);
    expect(importPhrase(phrase, 'extra').address).not.toBe(importPhrase(phrase).address);
    expect(() => importPhrase('not a phrase')).toThrow();
    expect(() => importPhrase(phrase, '', -1)).toThrow();
  });
  it('refuses mainnet and other chains', () => {
    expect(() => requireSepolia(1n)).toThrow('Only Ethereum Sepolia');
    expect(() => requireSepolia(11155111n)).not.toThrow();
  });
  it('validates literal addresses and exact positive amounts', () => {
    const address = '0x0000000000000000000000000000000000000001';
    expect(transferInput(address, '0.000000000000000001').value).toBe(1n);
    for (const amount of ['0', '-1', '1e3', '0.0000000000000000001', 'NaN']) {
      expect(() => transferInput(address, amount)).toThrow();
    }
    expect(() => transferInput('alice.eth', '1')).toThrow();
  });
  it('reserves the maximum gas cost before sending', () => {
    expect(() => affordable(100n, 21n, 2n, 141n)).toThrow();
    expect(() => affordable(100n, 21n, 2n, 142n)).not.toThrow();
  });
  it('requires matching passwords of sufficient length', () => {
    expect(() => validatePassword('short', 'short')).toThrow();
    expect(() => validatePassword('long-enough-password', 'different')).toThrow();
  });
  it('recovers the same wallet from encrypted JSON and rejects a wrong password', async () => {
    const wallet = Wallet.createRandom();
    const json = await wallet.encrypt('test-only-password');
    const keystore = JSON.parse(json);
    expect((keystore.Crypto ?? keystore.crypto).cipher).toBe('aes-128-ctr');
    expect(json).not.toContain(wallet.privateKey.slice(2));
    const restored = await Wallet.fromEncryptedJson(json, 'test-only-password');
    expect(restored.address).toBe(wallet.address);
    expect('mnemonic' in restored && restored.mnemonic?.phrase).toBe(wallet.mnemonic!.phrase);
    await expect(Wallet.fromEncryptedJson(json, 'wrong')).rejects.toThrow();
  }, 30000);
});
