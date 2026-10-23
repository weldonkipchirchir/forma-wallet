import { describe, expect, it } from 'vitest';
import { demoTransition, simulatorMarkup, type DemoState } from './ledger-simulator';
describe('Ledger simulator isolation and lifecycle', () => {
  it('requires connection and review before approval', () => {
    expect(demoTransition('disconnected', 'approve')).toBe('disconnected');
    expect(demoTransition('connected', 'approve')).toBe('connected');
    expect(demoTransition(demoTransition(demoTransition('disconnected', 'connect'), 'review'), 'approve')).toBe('approved');
  });
  it('supports rejection, retry and disconnect from every phase', () => {
    expect(demoTransition('reviewing', 'reject')).toBe('rejected');
    expect(demoTransition('rejected', 'review')).toBe('reviewing');
    for (const state of ['disconnected', 'connected', 'reviewing', 'approved', 'rejected'] as DemoState[]) {
      expect(demoTransition(state, 'disconnect')).toBe('disconnected');
    }
    expect(demoTransition('disconnected', 'review')).toBe('disconnected');
    expect(demoTransition('approved', 'approve')).toBe('approved');
  });
  it('clearly identifies the simulation without asking for secrets', () => {
    expect(simulatorMarkup()).toContain('DEMO ONLY');
    expect(simulatorMarkup()).toContain('No signing or broadcasting');
    expect(simulatorMarkup()).not.toContain('<input');
  });
});
