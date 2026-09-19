import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventStore } from '../server/src/store/EventStore.js';
import { SseHub } from '../server/src/services/SseHub.js';
import { RunService } from '../server/src/services/RunService.js';
import { FakeGenerator } from '../server/src/generators/FakeGenerator.js';

const tempDb=()=>path.join(os.tmpdir(),`caygnus-${process.pid}-${Math.random().toString(16).slice(2)}.json`);
const wait=async(fn,timeout=3000)=>{const start=Date.now();while(!fn()){if(Date.now()-start>timeout)throw new Error('timeout');await new Promise(r=>setTimeout(r,2))}};
const cleanup=(p)=>{for(const file of fs.readdirSync(path.dirname(p))){if(file.startsWith(path.basename(p)))fs.rmSync(path.join(path.dirname(p),file),{force:true});}};

for(const [name,count] of [['ordered live delivery',10],['replay after cursor',6],['replay/live overlap',8]]){
 test(name,async()=>{const p=tempDb(),store=new EventStore(p),hub=new SseHub(),service=new RunService({store,hub,generatorFactory:()=>new FakeGenerator({count,delayMs:1})});const received=[];hub.subscribe('placeholder',()=>{});const run=service.createRun({conversationId:'c',userMessageId:`m-${name}`,content:'hello'});const unsub=hub.subscribe(run.id,e=>received.push(e));await wait(()=>service.getRun(run.id).status==='completed');unsub();assert.deepEqual(received.map(e=>e.seq),Array.from({length:count+1},(_,i)=>i+1));cleanup(p)})}

test('replay returns every event after cursor',async()=>{const p=tempDb(),store=new EventStore(p),hub=new SseHub(),service=new RunService({store,hub,generatorFactory:()=>new FakeGenerator({count:6,delayMs:1})});const run=service.createRun({conversationId:'c',userMessageId:'replay',content:'hello'});await wait(()=>service.getRun(run.id).status==='completed');assert.deepEqual(service.events(run.id,3).map(e=>e.seq),[4,5,6,7]);cleanup(p)});

test('deduplication prevents replay/live overlap from displaying duplicates',async()=>{const p=tempDb(),store=new EventStore(p),hub=new SseHub(),service=new RunService({store,hub,generatorFactory:()=>new FakeGenerator({count:5,delayMs:1})});const run=service.createRun({conversationId:'c',userMessageId:'dedupe',content:'hello'});await wait(()=>service.getRun(run.id).status==='completed');const replay=service.events(run.id,2);let cursor=2,applied=[];for(const e of [...replay,replay[0],replay[1]]){if(e.seq<=cursor)continue;assert.equal(e.seq,cursor+1);cursor=e.seq;applied.push(e.seq)}assert.deepEqual(applied,[3,4,5,6]);cleanup(p)});

test('generator failure preserves partial history and cannot become completed',async()=>{const p=tempDb(),store=new EventStore(p),hub=new SseHub(),service=new RunService({store,hub,generatorFactory:()=>new FakeGenerator({count:10,delayMs:1,failAfter:4})});const run=service.createRun({conversationId:'c',userMessageId:'failure',content:'hello'});await wait(()=>service.getRun(run.id).status==='failed');const events=service.events(run.id,0);assert.equal(events.filter(e=>e.type==='text_delta').length,4);assert.equal(events.at(-1).type,'failed');assert.equal(service.getRun(run.id).status,'failed');cleanup(p)});

test('restart recovery marks in-progress run interrupted while preserving events',()=>{const p=tempDb(),store=new EventStore(p),hub=new SseHub();store.createConversation('c');store.createMessage({id:'m',conversationId:'c',role:'user',content:'hello',createdAt:new Date().toISOString()});store.createRun({id:'run_restart',conversationId:'c',userMessageId:'m',status:'running',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});store.appendEvent('run_restart','text_delta',{text:'partial'});const reopened=new EventStore(p);const ids=reopened.recoverInterruptedRuns();assert.deepEqual(ids,['run_restart']);assert.equal(reopened.getRun('run_restart').status,'failed');assert.equal(reopened.allEvents('run_restart').length,2);cleanup(p)});

test('idempotent message submission reuses the existing run',()=>{const p=tempDb(),store=new EventStore(p),hub=new SseHub(),service=new RunService({store,hub,generatorFactory:()=>new FakeGenerator({count:1,delayMs:0})});const a=service.createRun({conversationId:'c',userMessageId:'same',content:'hello'});const b=service.createRun({conversationId:'c',userMessageId:'same',content:'hello'});assert.equal(a.id,b.id);cleanup(p)});

test('HTTP stream explicitly rejects a cursor ahead of the durable server cursor', async () => {
  const p=tempDb();
  const store=new EventStore(p), hub=new SseHub();
  const service=new RunService({store,hub,generatorFactory:()=>new FakeGenerator({count:1,delayMs:5})});
  const {createServer}=await import('../server/src/server.js');
  const server=createServer({runService:service,store,hub,clientDir:path.resolve('client')});
  await new Promise(resolve=>server.listen(0,resolve));
  const port=server.address().port;
  const run=service.createRun({conversationId:'c',userMessageId:'cursor',content:'hello'});
  const response=await fetch(`http://127.0.0.1:${port}/api/runs/${run.id}/events?after=999`);
  const body=await response.json();
  assert.equal(response.status,409);
  assert.equal(body.error,'CURSOR_AHEAD_OF_SERVER');
  server.close();
  cleanup(p);
});
