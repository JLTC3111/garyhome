import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import test from 'node:test';
import { WebSocket, WebSocketServer } from 'ws';
import { serializeRealtimeReconnect } from '../lib/realtime-lifecycle.ts';

test('the installed Realtime client restores its channels after a delayed close and a later network drop',async t=>{
  const browser=new EventTarget();
  globalThis.window=browser;
  const {RealtimeClient}=await import('@supabase/supabase-js');
  const server=new WebSocketServer({host:'127.0.0.1',port:0});
  await once(server,'listening');

  const sockets=[],joins=[],states=new EventEmitter();
  let opened=0;
  class Transport extends WebSocket {
    constructor(...params) {super(...params);opened++;}
  }
  server.on('connection',socket=>{
    const connection=sockets.push(socket);
    socket.on('message',raw=>{
      const [joinRef,ref,topic,event]=JSON.parse(raw);
      if(event==='phx_join')joins.push(connection);
      socket.send(JSON.stringify([joinRef,ref,topic,'phx_reply',{status:'ok',response:{}}]));
    });
  });
  const client=new RealtimeClient(`ws://127.0.0.1:${server.address().port}/realtime/v1`,{
    params:{apikey:'local-fixture'},transport:Transport,reconnectAfterMs:()=>20,
  });
  t.after(async()=>{
    for(const socket of server.clients)socket.resume();
    await new Promise(resolve=>client.socketAdapter.getSocket().disconnect(resolve));
    await new Promise(resolve=>server.close(resolve));
    delete globalThis.window;
  });
  const nextJoin=()=>once(states,'SUBSCRIBED',{signal:AbortSignal.timeout(5_000)});
  const transition=type=>browser.dispatchEvent(Object.assign(new Event(type),{persisted:true}));
  serializeRealtimeReconnect(client);
  const initial=nextJoin();
  const channel=client.channel('gary-realtime-fixture').subscribe(status=>states.emit(status));
  await initial;

  const old=sockets[0];
  old.pause(); // Hold the close handshake while pageshow asks for a connection.
  transition('pagehide');
  assert.equal(client.connectionState(),'closing');
  const restored=nextJoin();
  transition('pageshow');
  transition('pageshow');
  const openedWhileClosing=opened;
  old.resume();
  await restored;
  assert.equal(openedWhileClosing,1);
  assert.deepEqual(joins,[1,2]);
  assert.deepEqual(client.getChannels(),[channel]);
  assert.equal(server.clients.size,1);

  const reconnected=nextJoin();
  sockets[1].terminate();
  await reconnected;
  assert.deepEqual(joins,[1,2,3]);
  assert.equal(opened,3);
  assert.deepEqual(client.getChannels(),[channel]);
});
