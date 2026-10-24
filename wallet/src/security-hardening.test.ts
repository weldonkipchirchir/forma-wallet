import { describe,it,expect,vi,afterEach } from 'vitest';
import { boundedJson,boundedText } from './bounded-response';
import { scrubSecretInputs } from './secret-inputs';
import { validateKeystore } from './security';
import { solRpc } from './multichain-network';
afterEach(()=>vi.unstubAllGlobals());
describe('hostile response boundaries',()=>{
  it('cancels oversized streams before buffering the entire body',async()=>{
    let cancelled=false;
    const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(11));},cancel(){cancelled=true;}});
    await expect(boundedText(new Response(body),10)).rejects.toThrow('supported size'); expect(cancelled).toBe(true);
  });
  it('rejects oversized declared lengths, malformed UTF-8 and JSON',async()=>{
    await expect(boundedText(new Response('short',{headers:{'content-length':'100'}}),10)).rejects.toThrow();
    await expect(boundedText(new Response(new Uint8Array([255])))).rejects.toThrow();
    await expect(boundedJson(new Response('{'))).rejects.toThrow();
    expect(await boundedJson(new Response('{"ok":true}'))).toEqual({ok:true});
  });
  it('rejects unrelated, batched and error-bearing Solana responses',async()=>{
    for(const body of [{jsonrpc:'2.0',id:2,result:1},{jsonrpc:'1.0',id:1,result:1},[{jsonrpc:'2.0',id:1,result:1}],{jsonrpc:'2.0',id:1,result:1,error:{message:'untrusted'}},{jsonrpc:'2.0',id:1}]) {
      vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(body)))); await expect(solRpc('getBlockHeight')).rejects.toThrow('request failed');
    }
  });
});
describe('encrypted recovery metadata boundary',()=>{
  const base={version:3,address:'11'.repeat(20),Crypto:{ciphertext:'11'.repeat(32),cipherparams:{iv:'22'.repeat(16)},mac:'33'.repeat(32),cipher:'aes-128-ctr',kdf:'scrypt',kdfparams:{salt:'44'.repeat(32),n:131072,r:8,p:1,dklen:32}}};
  const mnemonic={version:'0.1',mnemonicCounter:'55'.repeat(16),mnemonicCiphertext:'66'.repeat(16),path:"m/44'/60'/0'/0/0",locale:'en'};
  it('bounds encrypted entropy, counter, path and locale before decryption',()=>{
    expect(()=>validateKeystore(JSON.stringify({...base,'x-ethers':mnemonic}))).not.toThrow();
    for(const bad of [{mnemonicCiphertext:'11'.repeat(5000)},{mnemonicCounter:'12'},{path:'m'+"/1'".repeat(500)},{path:'m/4294967295'},{locale:'unexpected'},{version:'999'}]) expect(()=>validateKeystore(JSON.stringify({...base,'x-ethers':{...mnemonic,...bad}}))).toThrow('recovery metadata');
    expect(()=>validateKeystore(JSON.stringify({...base,address:'<script>'}))).toThrow('address');
  });
});
describe('DOM secret scrubbing',()=>{
  it('clears current/default values and remasks fields that were shown',()=>{
    const toggle={textContent:'Hide',setAttribute:vi.fn()};
    const input={value:'disposable-test-secret',defaultValue:'persisted-default',type:'text',removeAttribute:vi.fn(),labels:[{textContent:'Wallet password'}],parentElement:{querySelector:()=>toggle}};
    const host={querySelectorAll:()=>[input]} as unknown as ParentNode;
    scrubSecretInputs(host);
    expect(input.value).toBe('');expect(input.defaultValue).toBe('');expect(input.type).toBe('password');expect(input.removeAttribute).toHaveBeenCalledWith('value');expect(toggle.textContent).toBe('Show');
  });
});
