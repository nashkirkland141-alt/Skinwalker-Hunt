import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';

// Skinwalker: The Hunt | client prototype
const SUPABASE_URL = 'https://twsyqidzbgwidjnffhfb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_jkNeW0TBQTZ8VcEAudYAbw_xOt5ZVuQ';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = id => document.getElementById(id);
let user=null, channel=null, room='FOREST', playerName='Ranger', myRole='hunter';
let sanity=100, joinedAt=Date.now(), lastMove=0, lastShot=0, messageTimer=0;
const remoteModels={}, remotePositions={}, wildlife=[], keys={};
const caughtPlayers=new Set();
const loader=new GLTFLoader();
let deerTemplate=null, wendigoTemplate=null, wendigo=null, wendigoActive=false;
let yaw=0,pitch=0,locked=false, gameStarted=false, sanityElapsed=0;
let moveX=0,moveY=0,joyPointer=null,lookPointer=null,lastTouchX=0,lastTouchY=0;

// ---------- AUTH ----------
function authMessage(message,isError=false){$('authMessage').textContent=message;$('authMessage').style.color=isError?'#df9a83':'#a9bc91';}
$('signup').onclick=async()=>{
  const email=$('email').value.trim(), password=$('password').value;
  if(!email||password.length<6){authMessage('Enter a valid email and a password with at least 6 characters.',true);return;}
  $('signup').disabled=true;
  const username=(email.split('@')[0]||'Ranger').slice(0,16);
  const {error}=await supabase.auth.signUp({email,password,options:{data:{username}}});
  $('signup').disabled=false;
  if(error){authMessage(error.message,true);return;}
  authMessage('Verification email sent. Check your inbox, then sign in.');
};
$('signin').onclick=async()=>{
  const email=$('email').value.trim(),password=$('password').value;
  if(!email||!password){authMessage('Enter your email and password.',true);return;}
  $('signin').disabled=true;
  const {data,error}=await supabase.auth.signInWithPassword({email,password});
  $('signin').disabled=false;
  if(error){authMessage(error.message,true);return;}
  user=data.user; showLobby();
};
$('logout').onclick=async()=>{await supabase.auth.signOut();location.reload();};
$('returnMenu').onclick=async()=>{if(channel)await supabase.removeChannel(channel);location.reload();};
function showLobby(){ $('login').classList.add('hidden');$('lobby').classList.remove('hidden'); }
async function restoreSession(){const {data}=await supabase.auth.getSession();if(data.session){user=data.session.user;showLobby();}}
restoreSession();

// ---------- THREE.JS WORLD ----------
const scene=new THREE.Scene();
const baseFog=0x859087;scene.background=new THREE.Color(baseFog);scene.fog=new THREE.FogExp2(baseFog,.009);
const camera=new THREE.PerspectiveCamera(75,innerWidth/innerHeight,.1,450);camera.position.set(0,1.7,10);
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.outputColorSpace=THREE.SRGBColorSpace;$('game').appendChild(renderer.domElement);camera.add(new THREE.Group());scene.add(camera);
scene.add(new THREE.HemisphereLight(0xc7d3d0,0x293326,1.8));
const sun=new THREE.DirectionalLight(0xffe4bb,1.7);sun.position.set(-40,70,35);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);scene.add(sun);
const mat=(color,extra={})=>new THREE.MeshStandardMaterial({color,flatShading:true,...extra});
const M={ground:mat(0x46513a),trunk:mat(0x493729),leaves:mat(0x263d2c),leaves2:mat(0x354c34),road:mat(0x655e4c),cabin:mat(0x544333),roof:mat(0x292c29),black:mat(0x191b18),window:mat(0x9aa77e,{emissive:0x323c20})};
function addBox(w,h,d,material,x,y,z){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;scene.add(m);return m;}
function addTree(x,z,h){const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.35,.6,h,6),M.trunk);trunk.position.set(x,h/2,z);trunk.castShadow=true;scene.add(trunk);const leaves=new THREE.Mesh(new THREE.ConeGeometry(3,h*.8,6),M.leaves);leaves.position.set(x,h*.85,z);leaves.castShadow=true;scene.add(leaves);const upper=new THREE.Mesh(new THREE.ConeGeometry(2.2,h*.6,6),M.leaves2);upper.position.set(x,h*1.15,z);scene.add(upper);}
const ground=new THREE.Mesh(new THREE.PlaneGeometry(400,400),M.ground);ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);
addBox(11,.08,250,M.road,20,.04,0);addBox(140,.08,9,M.road,-40,.04,-35);
function makeCabin(x,z){addBox(9,4,8,M.cabin,x,2,z);const roof=new THREE.Mesh(new THREE.ConeGeometry(7,3,4),M.roof);roof.position.set(x,5,z);roof.rotation.y=Math.PI/4;scene.add(roof);addBox(1.2,2,.15,M.black,x,1,z+4.1);addBox(1.1,1.2,.12,M.window,x+3,2.4,z+4.1);}
makeCabin(-30,-35);makeCabin(-70,15);makeCabin(70,-70);makeCabin(65,70);
let seed=7823;function random(){seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;}
for(let i=0;i<430;i++){const x=(random()-.5)*330,z=(random()-.5)*330;if(Math.hypot(x,z)<17||Math.abs(x-20)<9)continue;addTree(x,z,6+random()*8);}

// ---------- REAL GLB MODELS ----------
function normalizeModel(root,targetHeight){
  root.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(root);const size=box.getSize(new THREE.Vector3());
  if(size.y>0){const s=targetHeight/size.y;root.scale.multiplyScalar(s);}
  root.updateMatrixWorld(true);const fitted=new THREE.Box3().setFromObject(root);const center=fitted.getCenter(new THREE.Vector3());
  root.position.x-=center.x;root.position.z-=center.z;root.position.y-=fitted.min.y;
  root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;if(o.material){o.material.side=THREE.DoubleSide;}}});
  return root;
}
function cloneModel(template){return template.clone(true);}
async function loadModels(){
  try{const gltf=await loader.loadAsync('./models/deer.glb');deerTemplate=normalizeModel(gltf.scene,2.45);}
  catch(e){console.error('Could not load deer.glb',e);}
  try{const gltf=await loader.loadAsync('./models/wendigo.glb');wendigoTemplate=normalizeModel(gltf.scene,3.35);}
  catch(e){console.error('Could not load wendigo.glb',e);}
  if(!deerTemplate)deerTemplate=createFallbackDeer();
  if(!wendigoTemplate)wendigoTemplate=createFallbackWendigo();
  spawnWildlife();
}
function createFallbackDeer(){const g=new THREE.Group(),m=mat(0x97724d);const body=new THREE.Mesh(new THREE.BoxGeometry(.7,.65,1.3),m);body.position.y=1.2;g.add(body);const head=new THREE.Mesh(new THREE.BoxGeometry(.35,.45,.4),m);head.position.set(0,2,-.65);g.add(head);return g;}
function createFallbackWendigo(){const g=new THREE.Group(),m=mat(0xaaa18b);const body=new THREE.Mesh(new THREE.BoxGeometry(.65,1.7,.4),m);body.position.y=1.2;g.add(body);const head=new THREE.Mesh(new THREE.SphereGeometry(.25,8,8),m);head.position.y=2.3;g.add(head);return g;}
function createDeer(){return cloneModel(deerTemplate||createFallbackDeer());}
function spawnWildlife(){if(wildlife.length)return;for(let i=0;i<15;i++){const mesh=createDeer(),x=(random()-.5)*100+35,z=(random()-.5)*100;mesh.position.set(x,0,z);mesh.rotation.y=random()*Math.PI*2;scene.add(mesh);wildlife.push({mesh,x,z,phase:random()*10,kind:'ai'});}}
loadModels();

// ---------- FIRST-PERSON TRANQUILIZER RIFLE ----------
const gun=new THREE.Group();camera.add(gun);const gunMat=mat(0x343a34,{metalness:.35,roughness:.65});
const gunBody=new THREE.Mesh(new THREE.BoxGeometry(.2,.17,.65),gunMat);gunBody.position.set(.35,-.3,-.65);gun.add(gunBody);
const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.04,.04,.5,8),gunMat);barrel.rotation.x=Math.PI/2;barrel.position.set(.35,-.25,-.98);gun.add(barrel);
const dartMat=mat(0xc2d89e,{emissive:0x4d5d32});

// ---------- MULTIPLAYER ----------
async function joinRoom(){
  if(!user)return;playerName=$('playerName').value.trim()||user.user_metadata?.username||'Ranger';room=($('roomCode').value.trim().toUpperCase()||'FOREST').replace(/[^A-Z0-9_-]/g,'').slice(0,12);
  $('lobbyMessage').textContent='Connecting to Blackpine...';
  channel=supabase.channel('forest-'+room,{config:{broadcast:{self:false},presence:{key:user.id}}});
  channel.on('presence',{event:'sync'},updatePresence)
    .on('broadcast',{event:'move'},({payload})=>{if(payload?.id&&payload.id!==user.id)remotePositions[payload.id]=payload;})
    .on('broadcast',{event:'capture'},({payload})=>handleCapture(payload))
    .on('broadcast',{event:'round_end'},({payload})=>endRound(payload?.winner));
  const status=await new Promise(resolve=>channel.subscribe(s=>resolve(s)));
  if(status!=='SUBSCRIBED'){$('lobbyMessage').textContent='Could not connect. Check your internet and try again.';return;}
  joinedAt=Date.now();await channel.track({id:user.id,name:playerName,joined:joinedAt,x:camera.position.x,z:camera.position.z,rot:yaw,caught:false});
  gameStarted=true;$('lobby').classList.add('hidden');$('hud').classList.remove('hidden');$('roomDisplay').textContent=room;$('sanityName').textContent=playerName.toUpperCase()+' SANITY';
  const mobile=matchMedia('(pointer: coarse)').matches;$('mobileControls').classList.toggle('hidden',!mobile);$('controls').textContent=mobile?'LEFT STICK MOVE · DRAG RIGHT TO LOOK · FIRE':'WASD MOVE · SHIFT SPRINT · CLICK FIRE · ESC UNLOCK';
  if(!mobile)renderer.domElement.requestPointerLock?.();setTimeout(updatePresence,400);
}
$('play').onclick=joinRoom;
function updatePresence(){if(!channel||!user)return;const state=channel.presenceState(),all=[];for(const list of Object.values(state)){for(const p of list){if(p.id&&!all.some(v=>v.id===p.id))all.push(p);}}all.sort((a,b)=>(a.joined||0)-(b.joined||0));const hunter=all[0];if(!hunter)return;
  myRole=hunter.id===user.id?'hunter':'deer';$('role').textContent=myRole==='hunter'?'HUNTER':'SKINWALKER DEER';$('objective').textContent=myRole==='hunter'?'Find the deer that does not belong.':'Blend in. Survive the hunt.';$('playerCount').textContent=all.length+(all.length===1?' PLAYER':' PLAYERS');
  for(const p of all){if(p.id===user.id)continue;if(!remoteModels[p.id]){const model=createDeer();scene.add(model);remoteModels[p.id]=model;}if(p.x!==undefined)remotePositions[p.id]=p;}
  for(const id of Object.keys(remoteModels)){if(!all.some(p=>p.id===id)){scene.remove(remoteModels[id]);delete remoteModels[id];delete remotePositions[id];}}
}
function handleCapture(payload){if(!payload)return;if(payload.target===user.id){caughtPlayers.add(user.id);showMessage('YOU HAVE BEEN CAPTURED.');$('objective').textContent='YOU HAVE BEEN TAKEN.';return;}if(payload.target&&remoteModels[payload.target])remoteModels[payload.target].visible=false;if(payload.by===user.id){if(payload.targetType==='ai'){sanity=Math.max(0,sanity-18);showMessage('WRONG DEER. SANITY -18');}else{sanity=Math.min(100,sanity+25);showMessage('SKINWALKER CAPTURED. SANITY +25');}}else showMessage((payload.name||'A player')+' was captured.');}

// ---------- INPUT: KEYBOARD + TOUCH ----------
document.addEventListener('keydown',e=>{keys[e.code]=true;});document.addEventListener('keyup',e=>{keys[e.code]=false;});
document.addEventListener('pointerlockchange',()=>{locked=document.pointerLockElement===renderer.domElement;});
document.addEventListener('mousemove',e=>{if(!locked)return;applyLook(e.movementX,e.movementY);});
function applyLook(dx,dy){yaw-=dx*.0022;pitch-=dy*.0022;pitch=THREE.MathUtils.clamp(pitch,-1.25,1.25);}
renderer.domElement.addEventListener('click',()=>{if(!matchMedia('(pointer: coarse)').matches&&!locked)renderer.domElement.requestPointerLock?.();});
document.addEventListener('mousedown',e=>{if(e.button===0&&locked&&myRole==='hunter')fireDart();});
const joy=$('joystick'),stick=$('stick');
joy.addEventListener('pointerdown',e=>{joyPointer=e.pointerId;joy.setPointerCapture(e.pointerId);updateJoystick(e);});
joy.addEventListener('pointermove',e=>{if(e.pointerId===joyPointer)updateJoystick(e);});
function releaseJoy(e){if(e.pointerId!==joyPointer)return;joyPointer=null;moveX=0;moveY=0;stick.style.transform='translate(0px,0px)';}
joy.addEventListener('pointerup',releaseJoy);joy.addEventListener('pointercancel',releaseJoy);
function updateJoystick(e){const r=joy.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,dx=e.clientX-cx,dy=e.clientY-cy,max=34,len=Math.hypot(dx,dy),scale=len>max?max/len:1;const x=dx*scale,y=dy*scale;stick.style.transform=`translate(${x}px,${y}px)`;moveX=x/max;moveY=y/max;}
const gameArea=$('game');gameArea.addEventListener('pointerdown',e=>{if(!gameStarted||!matchMedia('(pointer: coarse)').matches||e.clientX<innerWidth*.38)return;lookPointer=e.pointerId;lastTouchX=e.clientX;lastTouchY=e.clientY;gameArea.setPointerCapture(e.pointerId);});
gameArea.addEventListener('pointermove',e=>{if(e.pointerId!==lookPointer)return;const dx=e.clientX-lastTouchX,dy=e.clientY-lastTouchY;lastTouchX=e.clientX;lastTouchY=e.clientY;applyLook(dx,dy);});
function releaseLook(e){if(e.pointerId===lookPointer)lookPointer=null;}gameArea.addEventListener('pointerup',releaseLook);gameArea.addEventListener('pointercancel',releaseLook);
$('fireTouch').addEventListener('pointerdown',e=>{e.preventDefault();if(myRole==='hunter')fireDart();});

// ---------- CAPTURE ----------
const raycaster=new THREE.Raycaster();
function fireDart(){if(!channel||Date.now()-lastShot<700||myRole!=='hunter')return;lastShot=Date.now();const direction=new THREE.Vector3();camera.getWorldDirection(direction);const dart=new THREE.Mesh(new THREE.SphereGeometry(.055,6,6),dartMat);dart.position.copy(camera.position);scene.add(dart);
  raycaster.setFromCamera(new THREE.Vector2(0,0),camera);
  const targets=[];for(const [id,mesh] of Object.entries(remoteModels)){if(!caughtPlayers.has(id))targets.push({id,mesh,type:'player'});}for(let i=0;i<wildlife.length;i++)targets.push({id:'ai-'+i,mesh:wildlife[i].mesh,type:'ai'});
  const hits=raycaster.intersectObjects(targets.map(t=>t.mesh),true);let hitTarget=null;if(hits.length){let obj=hits[0].object;while(obj&&!targets.some(t=>t.mesh===obj))obj=obj.parent;if(obj)hitTarget=targets.find(t=>t.mesh===obj);}
  if(hitTarget){const targetPosition=hitTarget.type==='ai'?hitTarget.mesh.position:remotePositions[hitTarget.id];if(targetPosition){const distance=camera.position.distanceTo(new THREE.Vector3(targetPosition.x,1,targetPosition.z));if(distance<=26){if(hitTarget.type==='ai'){channel.send({type:'broadcast',event:'capture',payload:{target:hitTarget.id,by:user.id,targetType:'ai',name:'A deer'}});sanity=Math.max(0,sanity-18);hitTarget.mesh.visible=false;setTimeout(()=>{hitTarget.mesh.visible=true;},5000);showMessage('WRONG DEER. SANITY -18');}else{channel.send({type:'broadcast',event:'capture',payload:{target:hitTarget.id,by:user.id,targetType:'player',name:hitTarget.id}});sanity=Math.min(100,sanity+25);caughtPlayers.add(hitTarget.id);const m=remoteModels[hitTarget.id];if(m)m.visible=false;showMessage('SKINWALKER CAPTURED. SANITY +25');}}}}
  dart.position.copy(camera.position).addScaledVector(direction,30);setTimeout(()=>scene.remove(dart),180);
}

// ---------- WENDIGO AT ZERO SANITY ----------
function activateWendigo(){if(wendigoActive||!wendigoTemplate)return;wendigoActive=true;wendigo=cloneModel(wendigoTemplate);wendigo.position.set(camera.position.x+5,0,camera.position.z-12);scene.add(wendigo);scene.fog.color.set(0x242522);scene.fog.density=.021;scene.background=new THREE.Color(0x242522);$('objective').textContent='YOUR MIND IS BREAKING. IT FOUND YOU.';$('hud').classList.add('sanity-zero');showMessage('DO NOT LET IT GET CLOSE.');}
function updateWendigo(dt){if(!wendigoActive||!wendigo)return;const target=new THREE.Vector3(camera.position.x,0,camera.position.z);const dir=target.clone().sub(wendigo.position);const dist=dir.length();if(dist>0.01){dir.normalize();wendigo.position.addScaledVector(dir,dt*(dist<5?1.1:2.0));wendigo.rotation.y=Math.atan2(dir.x,dir.z);}if(dist<3.2){showMessage('IT FOUND YOU.');}}

// ---------- HUD ----------
function showMessage(text){$('message').textContent=text;$('message').style.opacity=1;messageTimer=2.5;}
function endRound(winner){$('resultTitle').textContent=winner==='hunter'?'HUNTER VICTORY':'SKINWALKERS WIN';$('resultMessage').textContent=winner==='hunter'?'Every skinwalker was captured.':'The forest kept its secrets.';$('result').classList.remove('hidden');}

// ---------- GAME LOOP ----------
let previousTime=performance.now();
function animate(now){requestAnimationFrame(animate);const dt=Math.min((now-previousTime)/1000,.05);previousTime=now;
  if(gameStarted&&channel&&user&&!caughtPlayers.has(user.id)){
    const forward=(keys.KeyW?1:0)-(keys.KeyS?1:0)-moveY;const sideways=(keys.KeyD?1:0)-(keys.KeyA?1:0)+moveX;const sprint=keys.ShiftLeft||keys.ShiftRight;const speed=(sprint?9:5.8)*dt;
    camera.position.x+=(-Math.sin(yaw)*forward+Math.cos(yaw)*sideways)*speed;camera.position.z+=(-Math.cos(yaw)*forward-Math.sin(yaw)*sideways)*speed;camera.position.x=THREE.MathUtils.clamp(camera.position.x,-180,180);camera.position.z=THREE.MathUtils.clamp(camera.position.z,-180,180);camera.position.y=1.7;camera.rotation.order='YXZ';camera.rotation.y=yaw;camera.rotation.x=pitch;
    if(now-lastMove>90){channel.send({type:'broadcast',event:'move',payload:{id:user.id,x:camera.position.x,z:camera.position.z,rot:yaw,name:playerName}});lastMove=now;}
    if(myRole==='hunter'){sanity=Math.max(0,sanity-dt*.75);}
    $('sanityNumber').textContent=Math.round(sanity)+'%';$('sanityFill').style.width=sanity+'%';$('sanityFill').style.background=sanity<25?'#b74b3f':sanity<50?'#c4a16b':'#a8c28e';if(sanity<=0&&myRole==='hunter')activateWendigo();
    for(const [id,mesh] of Object.entries(remoteModels)){const p=remotePositions[id];if(!p||caughtPlayers.has(id))continue;mesh.position.x=THREE.MathUtils.lerp(mesh.position.x,p.x,.18);mesh.position.z=THREE.MathUtils.lerp(mesh.position.z,p.z,.18);mesh.rotation.y=p.rot||0;}
    for(const deer of wildlife){deer.phase+=dt*.4;deer.mesh.position.x=deer.x+Math.sin(deer.phase)*2;deer.mesh.position.z=deer.z+Math.cos(deer.phase*.7)*2;deer.mesh.rotation.y=Math.sin(deer.phase)*.7;}
    updateWendigo(dt);if(messageTimer>0){messageTimer-=dt;if(messageTimer<=0)$('message').style.opacity=0;}
  }
  renderer.render(scene,camera);
}
requestAnimationFrame(animate);
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
