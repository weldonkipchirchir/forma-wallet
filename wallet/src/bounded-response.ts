export async function boundedText(response: Response, limit=2_000_000): Promise<string> {
  const declared=response.headers.get('content-length');
  if(declared && /^\d+$/.test(declared) && Number(declared)>limit) {await response.body?.cancel();throw new Error('Network response exceeds the supported size.');}
  const reader=response.body?.getReader(); if(!reader) throw new Error('Network returned an empty response.');
  const chunks: Uint8Array[]=[]; let size=0;
  try { while(true) {const row=await reader.read();if(row.done)break;size+=row.value.byteLength;if(size>limit) {await reader.cancel();throw new Error('Network response exceeds the supported size.');}chunks.push(row.value);} }
  finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
export async function boundedJson(response: Response,limit=2_000_000):Promise<any> {return JSON.parse(await boundedText(response,limit));}
