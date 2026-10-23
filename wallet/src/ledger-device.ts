import { DeviceManagementKitBuilder, DeviceStatus } from '@ledgerhq/device-management-kit';
import { webHidTransportFactory } from '@ledgerhq/device-transport-kit-web-hid';
import { SignerEthBuilder } from '@ledgerhq/device-signer-kit-ethereum';
import { ContextModuleBuilder } from '@ledgerhq/context-module';
import { firstValueFrom, take, timeout, takeUntil, fromEvent, type Subscription } from 'rxjs';
import { ledgerAction } from './ledger-action';
import { LEDGER_PATH, type LedgerSignature } from './ledger-safety';
export interface LedgerDevice {
  connect(): Promise<void>;
  address(): Promise<string>;
  sign(bytes: Uint8Array): Promise<LedgerSignature>;
  close(): void;
}
export function createLedgerDevice(progress: (text: string) => void, disconnected: () => void): LedgerDevice {
  const dmk = new DeviceManagementKitBuilder().addTransport(webHidTransportFactory).build();
  const abort = new AbortController();
  let session: string | undefined, stateSubscription: Subscription | undefined;
  const context = new ContextModuleBuilder({}).setBlindSigningReporter({ report: async () => { throw new Error('Blind-signing reporting is disabled.'); } }).build();
  const signer = () => { if (!session || abort.signal.aborted) throw new Error('Connect your Ledger again.'); return new SignerEthBuilder({ dmk, sessionId: session }).withContextModule(context).build(); };
  return {
    async connect() {
      const device = await firstValueFrom(dmk.startDiscovering({}).pipe(takeUntil(fromEvent(abort.signal, 'abort')), take(1), timeout(120000)));
      const id = await dmk.connect({ device }); session = id;
      if (abort.signal.aborted) { await dmk.disconnect({ sessionId: id }); throw new Error('Connection cancelled.'); }
      stateSubscription = dmk.getDeviceSessionState({ sessionId: id }).subscribe({
        next: state => { if (state.deviceStatus === DeviceStatus.NOT_CONNECTED) disconnected(); }, error: disconnected,
      });
    },
    async address() {
      const result = await ledgerAction(signer().getAddress(LEDGER_PATH, { checkOnDevice: true, chainId: 11155111 }), abort.signal, progress);
      return result.address;
    },
    sign(bytes) { return ledgerAction(signer().signTransaction(LEDGER_PATH, bytes), abort.signal, progress); },
    close() { if (abort.signal.aborted) return; abort.abort(); stateSubscription?.unsubscribe(); if (session) void dmk.disconnect({ sessionId: session }).catch(() => {}).finally(() => dmk.close()); else dmk.close(); },
  };
}
