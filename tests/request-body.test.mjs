import test from 'node:test';
import assert from 'node:assert/strict';
import {readJsonBody,BodyReadError} from '../lib/request-body.ts';
const encoder=new TextEncoder();
function streamed(chunks,{headers={},signal,stall=false}={}){
 const state={pulls:0,cancelled:false};
 const body=new ReadableStream({pull(controller){state.pulls++;if(chunks.length)controller.enqueue(chunks.shift());else if(!stall)controller.close();},cancel(){state.cancelled=true;}});
 return {state,input:new Request('https://gary.example/api/test',{method:'POST',body,duplex:'half',headers,signal})};
}
test('JSON request limits count UTF-8 bytes and preserve split Vietnamese characters',async()=>{
 const bytes=encoder.encode(JSON.stringify({name:'Hà Nội 🏠'}));
 const {input}=streamed([...bytes].map(byte=>new Uint8Array([byte])));
 assert.deepEqual(await readJsonBody(input,bytes.length),{name:'Hà Nội 🏠'});
 const tooSmall=streamed([bytes],{stall:true});await assert.rejects(readJsonBody(tooSmall.input,bytes.length-1),error=>error instanceof BodyReadError&&error.status===413);assert.equal(tooSmall.state.cancelled,true);
});
test('oversized chunked requests are cancelled even with a forged Content-Length',async()=>{
 for(const headers of [{},{'content-length':'1'}]){
  const {input,state}=streamed(Array.from({length:1000},()=>new Uint8Array(1024)),{headers});
  await assert.rejects(readJsonBody(input,2048),error=>error.status===413);
  assert.equal(state.cancelled,true);assert.ok(state.pulls<=4,'Do not buffer the whole body before rejecting it');
 }
});
test('declared oversized requests are cancelled before parsing and invalid JSON is rejected',async()=>{
 const declared=streamed([encoder.encode('{}')],{headers:{'content-length':'999'}});
 await assert.rejects(readJsonBody(declared.input,10),error=>error.status===413);assert.equal(declared.state.cancelled,true);
 for(const bytes of [encoder.encode('{'),new Uint8Array([123,34,120,34,58,34,255,34,125])]){
  await assert.rejects(readJsonBody(streamed([bytes]).input,100),error=>error instanceof BodyReadError&&error.status===400);
 }
});
test('stalled request bodies time out and cancel their stream',async()=>{
 const {input,state}=streamed([],{stall:true});
 await assert.rejects(readJsonBody(input,100,20),{name:'RequestTimeoutError'});assert.equal(state.cancelled,true);
});
test('an aborted client cancels a pending body without parsing or replay',async()=>{
 const controller=new AbortController(),{input,state}=streamed([],{stall:true,signal:controller.signal});
 const pending=readJsonBody(input,100,1000);await Promise.resolve();controller.abort();
 await assert.rejects(pending,{name:'AbortError'});assert.equal(state.cancelled,true);
});
test('an already-aborted request cancels its unread stream immediately',async()=>{
 const controller=new AbortController();controller.abort();const {input,state}=streamed([],{stall:true,signal:controller.signal});
 await assert.rejects(readJsonBody(input,100),{name:'AbortError'});assert.equal(state.cancelled,true);
});
