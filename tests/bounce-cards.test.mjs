import test from 'node:test';
import assert from 'node:assert/strict';
import {bounceSlots,pickBounceCard,createBounceAnimator} from '../lib/bounce-cards.ts';
const config={cardSize:200,pushDistance:160,hoverScale:1.06,bounciness:.6,animationDelay:.5,animationStagger:.06};
function clock(){let now=0,id=0;const frames=new Map();return {now:()=>now,request:fn=>{frames.set(++id,fn);return id;},cancel:i=>frames.delete(i),get pending(){return frames.size;},advance(ms=16.667){now+=ms;const work=[...frames.values()];frames.clear();for(const fn of work)fn(now);},settle(ms=16.667){let ticks=0;while(frames.size&&ticks++<1000)this.advance(ms);assert.ok(ticks<1000,'springs must stop scheduling frames');return ticks;}};}
test('the original fan spacing and picking stay stable while neighbours move',()=>{
 const slots=bounceSlots(4,85,10,0);assert.deepEqual(slots.map(s=>s.x),[-127.5,-42.5,42.5,127.5]);assert.deepEqual(slots.map(s=>s.rotate),[10,5,-3,-10]);
 assert.equal(pickBounceCard(slots,1,0,200,1,160),1);assert.equal(pickBounceCard(slots,5,0,200,1,160),2);
 for(let i=0;i<20;i++)assert.equal(pickBounceCard(slots,42.5,0,200,2,160),2);
 assert.equal(pickBounceCard(slots,350,0,200,2,160),3);assert.equal(pickBounceCard(slots,0,300,200,2,160),-1);
});

test('landscape district picking respects photo height and spaced hover never moves neighbouring cards over their labels',()=>{
 const slots=bounceSlots(4,306,2.25,0),width=282,height=width*9/16;
 assert.equal(pickBounceCard(slots,slots[1].x,0,width,-1,0,height),1);
 assert.equal(pickBounceCard(slots,slots[1].x,120,width,-1,0,height),-1);
 const time=clock();let pose;const engine=createBounceAnimator(slots,{...config,cardSize:width,pushDistance:0,hoverScale:1.025},time,p=>pose=p);
 engine.activate(1);time.settle();assert.equal(pose[1].scale,1.025);assert.equal(pose[1].rotate,0);
 for(const i of [0,2,3])assert.equal(pose[i].x,slots[i].x);
 engine.activate(-1);time.settle();assert.deepEqual(pose,slots.map(s=>({...s,scale:1})));assert.equal(time.pending,0);
});
test('hover uses the full push distance, rapid changes settle and no idle frames remain',()=>{
 const time=clock(),slots=bounceSlots(4,85,10,0);let pose,active;
 const engine=createBounceAnimator(slots,config,time,(p,a)=>{pose=p;active=a;});engine.activate(2);time.settle();
 assert.equal(active,2);assert.equal(pose[2].scale,1.06);assert.equal(pose[2].rotate,0);assert.equal(pose[2].y,-8);assert.equal(pose[0].x,slots[0].x-160);assert.equal(pose[3].x,slots[3].x+160);assert.equal(time.pending,0);
 for(const index of [0,3,1,2,0,3]){engine.activate(index);time.advance();}time.settle();assert.equal(active,3);assert.ok(pose.every(p=>Object.values(p).every(Number.isFinite)));engine.activate(3);assert.equal(time.pending,0);
 engine.activate(-1);time.settle();assert.deepEqual(pose,slots.map(s=>({...s,scale:1})));engine.destroy();assert.equal(time.pending,0);
});
test('intro timing is staggered and low-frame-rate recovery cannot leave springs running',()=>{
 const time=clock(),slots=bounceSlots(4,85,10,0);let pose;const engine=createBounceAnimator(slots,config,time,p=>pose=p);engine.reveal();time.advance(400);assert.ok(pose.every(p=>p.scale===0));time.advance(150);assert.ok(pose[0].scale>0);assert.equal(pose[3].scale,0);time.settle(100);assert.ok(pose.every(p=>p.scale===1));assert.equal(time.pending,0);engine.destroy();
});
test('hidden tabs, resize and teardown cancel the active animation and late callbacks',()=>{
 const time=clock();let pose,paints=0;const engine=createBounceAnimator(bounceSlots(4,85,10,0),config,time,p=>{pose=p;paints++;});engine.activate(1);time.advance();engine.pause();assert.equal(time.pending,0);assert.equal(pose[1].scale,1.06);engine.resume();engine.layout(bounceSlots(4,68,10,0),{...config,cardSize:160,pushDistance:128});time.settle();assert.equal(pose[0].x,-102-128);engine.activate(3);engine.destroy();const previous=paints;time.advance(5000);assert.equal(paints,previous);assert.equal(time.pending,0);
});
