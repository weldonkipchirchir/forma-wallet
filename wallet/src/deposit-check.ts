import {getAddress,id} from 'ethers';
const transferTopic=id('Transfer(address,address,uint256)');
export type DepositReceipt={hash:string;status:number|null;logs:readonly {address:string;topics:readonly string[];data:string}[]};
export function depositContracts(receipt:DepositReceipt,hash:string,owner:string):string[]{
  if(!/^0x[a-f0-9]{64}$/i.test(hash)||receipt.hash.toLowerCase()!==hash.toLowerCase())throw new Error('Transaction identity differs from the requested hash.');
  if(receipt.status!==1)throw new Error('This transaction did not complete successfully.');
  if(receipt.logs.length>2000)throw new Error('Too many transaction logs. Inspect this transaction on the explorer.');
  const target=getAddress(owner).slice(2).toLowerCase().padStart(64,'0'),contracts=new Set<string>();
  for(const log of receipt.logs){
    if(log.topics.length!==3||log.topics[0].toLowerCase()!==transferTopic||!/^0x[0-9a-f]{64}$/i.test(log.topics[1])||log.topics[2].toLowerCase()!=='0x'+target||!/^0x[0-9a-f]{64}$/i.test(log.data)||BigInt(log.data)===0n)continue;
    try{contracts.add(getAddress(log.address));}catch{/* Invalid log addresses cannot be imported. */}
  }
  return [...contracts].slice(0,20);
}
