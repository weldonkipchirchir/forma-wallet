export type BridgeNetwork={id:string;chainId:number;symbol:string;decimals:number;vm:'evm'|'svm'|'bvm';native:string;protocol:string;depository?:string};
export const BRIDGE_NETWORKS:readonly BridgeNetwork[];
export function bridgeNetwork(id:string):BridgeNetwork;
export function validBridgeAddress(value:string,vm:string):string;
export function bridgeRequest(value:unknown):{from:BridgeNetwork;to:BridgeNetwork;amount:string;user:string;recipient:string};
