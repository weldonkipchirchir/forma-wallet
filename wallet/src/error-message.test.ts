import { describe, expect, it } from 'vitest';
import { walletErrorMessage } from './error-message';

describe('wallet notices', () => {
  it('turns incorrect-password diagnostics into a short instruction', () => {
    const error = Object.assign(new Error('incorrect password (argument="password", value="private-input", code=INVALID_ARGUMENT, version=6.17.0)'), { code: 'INVALID_ARGUMENT' });
    expect(walletErrorMessage(error)).toBe('Incorrect password. Please try again.');
  });
  it('does not expose RPC diagnostics or unknown library arguments', () => {
    expect(walletErrorMessage(Object.assign(new Error('request=https://private.example'), { code: 'NETWORK_ERROR' }))).toBe('Unable to connect to Sepolia. Check your connection and try again.');
    expect(walletErrorMessage(Object.assign(new Error('private-input'), { code: 'UNKNOWN_ERROR' }))).toBe('Something went wrong. Please try again.');
    expect(walletErrorMessage(new Error('failure (value="private-input")'))).toBe('Something went wrong. Please try again.');
  });
  it('preserves useful app validation and handles non-errors', () => {
    expect(walletErrorMessage(new Error('The passwords do not match.'))).toBe('The passwords do not match.');
    expect(walletErrorMessage(null)).toBe('Something went wrong. Please try again.');
  });
});
