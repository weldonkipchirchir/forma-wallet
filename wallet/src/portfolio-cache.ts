import type {Wallet,HDNodeWallet} from 'ethers';
import type {NetworkHolding} from './cross-network-data';
import type {NetworkId} from './network-context';
type Snapshot={connection:string;rows:NetworkHolding[];failed:NetworkId[];when:number;prices:Record<string,number>};
/** Public snapshots only, scoped to the unlocked wallet object and environment. */
export const portfolioCache=new WeakMap<Wallet|HDNodeWallet,Map<boolean,Snapshot>>();
export function invalidatePortfolioCache(wallet:Wallet|HDNodeWallet){portfolioCache.delete(wallet);}
