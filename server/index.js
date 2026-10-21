import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';

const PORT=Number(process.env.PORT||8080);
const TICK_MS=50, BROADCAST_MS=100;
const MAPS={forest:{w:1600,h:1300},blueforest:{w:1600,h:1300},purpleforest:{w:1600,h:1300}};
const rooms=new Map();
const now=()=>Date.now();
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const finite=(n)=>typeof n==='number'&&Number.isFinite(n);
const send=(ws,data)=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(data))};
const random=(a,b)=>a+Math.random()*(b-a);
function roomFor(map){
 if(!rooms.has(map))rooms.set(map,{map,players:new Map(),enemies:new Map(),projectiles:[],lastSpawn:0,sequence:0});
 return rooms.get(map);
}
function spawn(room){
 const cfg=MAPS[room.map];if(!cfg||room.enemies.size>=12)return;
 const k=Math.floor(Math.random()*4),hard=room.map!=='forest',purple=room.map==='purpleforest';
 const hp=(purple?35:hard?19:9)+k*(hard?5:3);
 const enemy={id:randomUUID(),x:random(80,cfg.w-80),y:random(115,cfg.h-80),kind:k,hp,max:hp,speed:(purple?66:hard?53:38)+k*9,damage:(purple?16:hard?7:4)+k*(purple?3:2),cool:random(0,1),orbCooldown:3};
 room.enemies.set(enemy.id,enemy);
}
function snapshot(room){return {type:'snapshot',map:room.map,seq:++room.sequence,serverTime:now(),players:[...room.players.values()].map(p=>({id:p.id,x:p.x,y:p.y,hp:p.hp,maxHp:p.maxHp,name:p.name})),enemies:[...room.enemies.values()].map(e=>({id:e.id,x:e.x,y:e.y,kind:e.kind,hp:e.hp,max:e.max,speed:e.speed,damage:e.damage})),projectiles:room.projectiles.map(p=>({id:p.id,x:p.x,y:p.y}))}}
function tick(dt){
 for(const room of rooms.values()){
  if(!room.players.size)continue;
  if(now()-room.lastSpawn>3800){spawn(room);room.lastSpawn=now()}
  for(const e of room.enemies.values()){
   let target=null,best=Infinity;
   for(const p of room.players.values()){const d=Math.hypot(p.x-e.x,p.y-e.y);if(d<best){best=d;target=p}}
   if(!target)continue;
   const dx=target.x-e.x,dy=target.y-e.y,d=Math.hypot(dx,dy)||1;
   if(d>27){const step=Math.min(d-27,e.speed*dt);e.x+=dx/d*step;e.y+=dy/d*step}
   e.cool-=dt;
   if(d<=28&&e.cool<=0){e.cool=1;target.hp=Math.max(0,target.hp-e.damage);send(target.ws,{type:'hurt',hp:target.hp,damage:e.damage,enemyId:e.id})}
   if(room.map==='purpleforest'){e.orbCooldown-=dt;if(e.orbCooldown<=0){e.orbCooldown=3;room.projectiles.push({id:randomUUID(),x:e.x,y:e.y,vx:dx/d*260,vy:dy/d*260,damage:Math.max(3,Math.round(e.damage*.75)),ttl:3})}}
  }
  for(const p of room.projectiles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.ttl-=dt;for(const target of room.players.values()){if(p.ttl<=0)break;if(Math.hypot(p.x-target.x,p.y-target.y)<23){target.hp=Math.max(0,target.hp-p.damage);send(target.ws,{type:'hurt',hp:target.hp,damage:p.damage,projectileId:p.id});p.ttl=0}}}
  room.projectiles=room.projectiles.filter(p=>p.ttl>0);
 }
}
const server=http.createServer((req,res)=>{if(req.url==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,rooms:rooms.size}));return}res.writeHead(404);res.end('Not found')});
const wss=new WebSocketServer({server,maxPayload:8192});
wss.on('connection',ws=>{
 const id=randomUUID();let room=null,player=null,lastInput=0,lastAttack=0;
 ws.on('message',raw=>{let msg;try{msg=JSON.parse(raw.toString())}catch{return}
  if(!msg||typeof msg.type!=='string')return;
  if(msg.type==='join'){
   if(room)return;
   const map=String(msg.map||'');if(!MAPS[map])return send(ws,{type:'error',message:'Unsupported map'});
   room=roomFor(map);const cfg=MAPS[map];
   player={id,ws,x:clamp(finite(msg.x)?msg.x:200,20,cfg.w-20),y:clamp(finite(msg.y)?msg.y:200,85,cfg.h-20),hp:100,maxHp:100,lastMoveAt:now(),name:String(msg.name||'Player').slice(0,24)};
   room.players.set(id,player);send(ws,{type:'welcome',id,map,tickMs:TICK_MS});send(ws,snapshot(room));return;
  }
  if(!room||!player)return;
  if(msg.type==='position'){
   // Server validates reported coordinates against elapsed-time movement budget.
   // This is a transitional protocol until all movement is server-simulated.
   if(!finite(msg.x)||!finite(msg.y))return;
   const t=now(),elapsed=clamp((t-player.lastMoveAt)/1000,0,.3);
   if(elapsed<.035)return;
   player.lastMoveAt=t;
   const cfg=MAPS[room.map],tx=clamp(msg.x,20,cfg.w-20),ty=clamp(msg.y,85,cfg.h-20);
   const dx=tx-player.x,dy=ty-player.y,dist=Math.hypot(dx,dy);
   const limit=340*elapsed+8;
   if(dist>0){const ratio=Math.min(1,limit/dist);player.x+=dx*ratio;player.y+=dy*ratio}
  }else if(msg.type==='input'){
   const t=now();if(t-lastInput<25)return;lastInput=t;
   const dx=finite(msg.dx)?clamp(msg.dx,-1,1):0,dy=finite(msg.dy)?clamp(msg.dy,-1,1):0;
   const len=Math.max(1,Math.hypot(dx,dy)),speed=170,step=speed*.12;
   const cfg=MAPS[room.map];player.x=clamp(player.x+dx/len*step,20,cfg.w-20);player.y=clamp(player.y+dy/len*step,85,cfg.h-20);
  }else if(msg.type==='attack'){
   const t=now();if(t-lastAttack<380)return;lastAttack=t;
   const dx=finite(msg.dx)?msg.dx:1,dy=finite(msg.dy)?msg.dy:0,len=Math.hypot(dx,dy)||1;
   let hit=null,best=Infinity;
   for(const e of room.enemies.values()){const ex=e.x-player.x,ey=e.y-player.y,d=Math.hypot(ex,ey);if(d>85||d>=best||(ex*dx+ey*dy)/(d*len)<.25)continue;hit=e;best=d}
   if(hit){hit.hp-=8;if(hit.hp<=0){room.enemies.delete(hit.id);send(ws,{type:'kill',enemyId:hit.id})}}
  }
 });
 ws.on('close',()=>{if(room){room.players.delete(id);if(!room.players.size){room.enemies.clear();room.projectiles=[]}}});
 ws.on('error',()=>{});
});
setInterval(()=>tick(TICK_MS/1000),TICK_MS);
setInterval(()=>{for(const room of rooms.values())if(room.players.size){const data=snapshot(room);for(const p of room.players.values())send(p.ws,data)}},BROADCAST_MS);
server.listen(PORT,()=>console.log('Sunny Quest authoritative server listening on '+PORT));
