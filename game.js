
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

// ===========================================
// CONFIGURATION
// ===========================================

const SUPABASE_URL = "https://twsyqidzbgwidjnffhfb.supabase.co";
const SUPABASE_KEY = "sb_publishable_jkNeW0TBQTZ8VcEAudYAbw_xOt5ZVuQ";

const ASSETS = {
  forest: "./assets/forest.glb",
  deer: "./assets/low_poly_deer_elk.glb",
  wendigo: "./assets/wendigo.glb"
};

const supabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

const $ = id => document.getElementById(id);

let user = null;
let channel = null;
let room = "";
let role = "waiting";
let joinedAt = Date.now();

let scene, camera, renderer, clock;
let deerTemplate = null;
let wendigoTemplate = null;
let wendigoInstance = null;

let sanity = 100;
let running = false;
let yaw = 0;
let pitch = 0;
let lastSend = 0;
let sanityTimer = 0;
let mobileMove = { x: 0, y: 0 };

const keys = {};
const players = new Map();
const animals = [];

const loader = new GLTFLoader();
const raycaster = new THREE.Raycaster();

function say(id, text) {
  $(id).textContent = text;
}

function notify(text) {
  say("message", text);
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => say("message", ""), 1800);
}

// ===========================================
// AUTHENTICATION
// ===========================================

$("signup").onclick = async () => {
  const email = $("email").value.trim();
  const password = $("password").value;

  if (!email || password.length < 6) {
    say("authMessage", "Enter a valid email and a password of at least 6 characters.");
    return;
  }

  $("signup").disabled = true;
  say("authMessage", "Creating account...");

  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: location.origin
      }
    });

    if (error) throw error;

    if (data.session) {
      user = data.user;
      openLobby();
    } else {
      say("authMessage", "Account created. Check your email to verify it, then log in.");
    }
  } catch (error) {
    say("authMessage", error.message);
  } finally {
    $("signup").disabled = false;
  }
};

$("login").onclick = async () => {
  const email = $("email").value.trim();
  const password = $("password").value;

  if (!email || !password) {
    say("authMessage", "Enter your email and password.");
    return;
  }

  $("login").disabled = true;
  say("authMessage", "Logging in...");

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    user = data.user;
    openLobby();
  } catch (error) {
    say("authMessage", error.message);
  } finally {
    $("login").disabled = false;
  }
};

$("logout").onclick = async () => {
  await supabase.auth.signOut();
  user = null;
  $("lobby").classList.add("hidden");
  $("auth").classList.remove("hidden");
};

const session = await supabase.auth.getSession();

if (session.data.session) {
  user = session.data.session.user;
  openLobby();
}

function openLobby() {
  $("auth").classList.add("hidden");
  $("lobby").classList.remove("hidden");
  say("welcome", "Logged in as " + user.email);
}

// ===========================================
// MULTIPLAYER ROOMS
// ===========================================

function newCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

$("createRoom").onclick = () => enterRoom(newCode());

$("joinRoom").onclick = () => {
  const code = $("roomCode").value.trim().toUpperCase();

  if (code.length < 4) {
    say("lobbyMessage", "Enter a room code.");
    return;
  }

  enterRoom(code);
};

async function enterRoom(code) {
  if (!user) return;

  if (channel) await supabase.removeChannel(channel);

  room = code;
  joinedAt = Date.now();

  say("lobbyMessage", "Connecting...");

  channel = supabase.channel("hunt-" + room, {
    config: {
      presence: { key: user.id },
      broadcast: { self: false }
    }
  });

  channel
    .on("presence", { event: "sync" }, assignRoles)
    .on("presence", { event: "join" }, assignRoles)
    .on("presence", { event: "leave" }, assignRoles)
    .on("broadcast", { event: "position" }, ({ payload }) => {
      const player = players.get(payload.id);
      if (player) {
        player.mesh.position.set(payload.x, 0, payload.z);
      }
    })
    .on("broadcast", { event: "captured" }, ({ payload }) => {
      if (payload.id === user.id) {
        notify("YOU HAVE BEEN CAPTURED");
        setTimeout(leaveGame, 1500);
      }
    });

  channel.subscribe(async status => {
    if (status === "SUBSCRIBED") {
      await channel.track({
        id: user.id,
        joinedAt,
        x: 0,
        z: 0
      });

      $("lobby").classList.add("hidden");
      $("gameScreen").classList.remove("hidden");

      say("roomLabel", "ROOM: " + room);
      say("lobbyMessage", "");

      await startGame();
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      say("lobbyMessage", "Connection failed. Check Supabase Realtime.");
    }
  });
}

function assignRoles() {
  const people = Object.values(channel.presenceState()).flat();
  people.sort((a, b) => a.joinedAt - b.joinedAt);

  role = people[0]?.id === user.id ? "hunter" : "skinwalker";

  say("roleLabel", "ROLE: " + role.toUpperCase());
  say(
    "objective",
    role === "hunter"
      ? "Capture the disguised skinwalkers."
      : "Blend in with the deer. Avoid the hunter."
  );

  const ids = new Set();

  for (const person of people) {
    if (person.id === user.id) continue;

    ids.add(person.id);

    if (!players.has(person.id)) {
      const mesh = createDeer();
      scene?.add(mesh);
      players.set(person.id, { mesh });
    }
  }

  for (const [id, player] of players) {
    if (!ids.has(id)) {
      scene?.remove(player.mesh);
      players.delete(id);
    }
  }
}

// ===========================================
// MODEL LOADING
// ===========================================

async function loadModel(path) {
  const gltf = await loader.loadAsync(path);
  return gltf.scene;
}

function fitModel(model, height) {
  const bounds = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  bounds.getSize(size);

  const factor = height / Math.max(size.y, 0.001);
  model.scale.multiplyScalar(factor);
  model.updateMatrixWorld(true);

  const scaled = new THREE.Box3().setFromObject(model);
  model.position.y -= scaled.min.y;

  model.traverse(object => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });

  return model;
}

async function loadAssets() {
  const results = await Promise.allSettled([
    loadModel(ASSETS.forest),
    loadModel(ASSETS.deer),
    loadModel(ASSETS.wendigo)
  ]);

  if (results[0].status === "fulfilled") {
    const forest = results[0].value;
    forest.scale.setScalar(1);

    forest.traverse(object => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });

    scene.add(forest);
  } else {
    console.error("Forest failed to load:", results[0].reason);
    makeGround();
  }

  if (results[1].status === "fulfilled") {
    deerTemplate = fitModel(results[1].value, 1.7);
    console.log("Real deer model loaded.");
  } else {
    console.error("Deer model failed to load:", results[1].reason);
  }

  if (results[2].status === "fulfilled") {
    wendigoTemplate = fitModel(results[2].value, 3.5);
    console.log("Wendigo model loaded.");
  } else {
    console.error("Wendigo model failed to load:", results[2].reason);
  }
}

// ===========================================
// THREE.JS WORLD
// ===========================================

async function startGame() {
  if (running) return;

  running = true;
  sanity = 100;
  sanityTimer = 0;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111a14);
  scene.fog = new THREE.FogExp2(0x111a14, 0.012);

  camera = new THREE.PerspectiveCamera(
    75,
    innerWidth / innerHeight,
    0.1,
    1000
  );

  camera.position.set(0, 1.7, 0);
  camera.rotation.order = "YXZ";

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;

  $("world").replaceChildren(renderer.domElement);

  clock = new THREE.Clock();

  scene.add(new THREE.HemisphereLight(0xa9bda8, 0x10140d, 1.1));

  const moon = new THREE.DirectionalLight(0xc3d2cf, 1.3);
  moon.position.set(-30, 50, 20);
  moon.castShadow = true;
  scene.add(moon);

  try {
    await loadAssets();
  } catch (error) {
    console.error(error);
  }

  createAnimals();

  renderer.domElement.addEventListener("click", () => {
    if (matchMedia("(pointer:fine)").matches) {
      renderer.domElement.requestPointerLock?.();
    }
  });

  renderer.domElement.addEventListener("pointerdown", event => {
    if (event.pointerType === "touch") {
      lookTouchStart = { x: event.clientX, y: event.clientY };
    }
  });

  renderer.domElement.addEventListener("pointermove", event => {
    if (event.pointerType !== "touch" || !lookTouchStart) return;

    yaw -= (event.clientX - lookTouchStart.x) * 0.005;
    pitch -= (event.clientY - lookTouchStart.y) * 0.005;
    pitch = THREE.MathUtils.clamp(pitch, -1.4, 1.4);

    lookTouchStart = { x: event.clientX, y: event.clientY };
  });

  renderer.domElement.addEventListener("pointerup", () => {
    lookTouchStart = null;
  });

  document.addEventListener("mousemove", mouseLook);
  window.addEventListener("keydown", e => keys[e.code] = true);
  window.addEventListener("keyup", e => keys[e.code] = false);
  window.addEventListener("resize", resize);

  setupJoystick();
  updateSanity();
  animate();
}

let lookTouchStart = null;

function makeGround() {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(500, 500),
    new THREE.MeshStandardMaterial({ color: 0x18271a })
  );

  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.1;
  ground.receiveShadow = true;
  scene.add(ground);
}

// ===========================================
// DEER AND SKINWALKER MODELS
// ===========================================

function createDeer() {
  if (deerTemplate) {
    const deer = deerTemplate.clone(true);
    deer.userData.isDeer = true;
    return deer;
  }

  const fallback = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(.65, .65, 1.25),
    new THREE.MeshStandardMaterial({ color: 0x70513a })
  );

  body.position.y = .95;
  fallback.add(body);
  fallback.userData.isDeer = true;
  return fallback;
}

function createAnimals() {
  for (let i = 0; i < 8; i++) {
    const mesh = createDeer();

    mesh.position.set(
      (Math.random() - .5) * 80,
      0,
      (Math.random() - .5) * 80
    );

    scene.add(mesh);

    animals.push({
      mesh,
      direction: Math.random() * Math.PI * 2,
      timer: Math.random() * 4
    });
  }
}

function updateAnimals(delta) {
  for (const animal of animals) {
    animal.timer -= delta;

    if (animal.timer <= 0) {
      animal.direction += (Math.random() - .5) * 2;
      animal.timer = 2 + Math.random() * 4;
    }

    animal.mesh.position.x += Math.sin(animal.direction) * delta;
    animal.mesh.position.z += Math.cos(animal.direction) * delta;
    animal.mesh.rotation.y = animal.direction;
  }
}

// ===========================================
// CAMERA AND MOVEMENT
// ===========================================

function mouseLook(event) {
  if (document.pointerLockElement !== renderer?.domElement) return;

  yaw -= event.movementX * .002;
  pitch -= event.movementY * .002;
  pitch = THREE.MathUtils.clamp(pitch, -1.4, 1.4);
}

function movePlayer(delta) {
  let x = 0;
  let z = 0;

  if (keys.KeyW) z -= 1;
  if (keys.KeyS) z += 1;
  if (keys.KeyA) x -= 1;
  if (keys.KeyD) x += 1;

  x += mobileMove.x;
  z += mobileMove.y;

  const length = Math.hypot(x, z);

  if (length > 1) {
    x /= length;
    z /= length;
  }

  const speed = 7 * delta;
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);

  camera.position.x += (x * cos - z * sin) * speed;
  camera.position.z += (z * cos + x * sin) * speed;
  camera.position.y = 1.7;

  camera.rotation.set(pitch, yaw, 0, "YXZ");
}

// ===========================================
// MOBILE CONTROLS
// ===========================================

function setupJoystick() {
  const joystick = $("joystick");
  const stick = $("stick");

  let active = false;

  joystick.addEventListener("pointerdown", event => {
    active = true;
    joystick.setPointerCapture(event.pointerId);
    updateStick(event);
  });

  joystick.addEventListener("pointermove", event => {
    if (active) updateStick(event);
  });

  function updateStick(event) {
    const rect = joystick.getBoundingClientRect();
    let dx = event.clientX - (rect.left + rect.width / 2);
    let dy = event.clientY - (rect.top + rect.height / 2);

    const length = Math.hypot(dx, dy);
    const max = 38;

    if (length > max) {
      dx = dx / length * max;
      dy = dy / length * max;
    }

    stick.style.transform = `translate(${dx}px,${dy}px)`;
    mobileMove.x = dx / max;
    mobileMove.y = dy / max;
  }

  function release() {
    active = false;
    mobileMove = { x: 0, y: 0 };
    stick.style.transform = "translate(0,0)";
  }

  joystick.addEventListener("pointerup", release);
  joystick.addEventListener("pointercancel", release);

  $("fireButton").addEventListener("pointerdown", event => {
    event.preventDefault();
    fire();
  });
}

// ===========================================
// TRANQUILIZER GUN
// ===========================================

function fire() {
  if (!running || role !== "hunter") return;

  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  raycaster.far = 35;

  const targets = [];

  for (const [id, player] of players) {
    player.mesh.userData.playerId = id;
    targets.push(player.mesh);
  }

  for (const animal of animals) {
    targets.push(animal.mesh);
  }

  const hits = raycaster.intersectObjects(targets, true);

  if (!hits.length) {
    notify("MISSED");
    return;
  }

  let target = hits[0].object;

  while (target && !target.userData.playerId && !target.userData.isDeer) {
    target = target.parent;
  }

  if (!target) return;

  if (target.userData.playerId) {
    channel.send({
      type: "broadcast",
      event: "captured",
      payload: { id: target.userData.playerId }
    });

    sanity = Math.min(100, sanity + 20);
    notify("SKINWALKER CAPTURED");
  } else if (target.userData.isDeer) {
    target.visible = false;
    sanity = Math.max(0, sanity - 20);
    notify("WRONG TARGET");
  }

  updateSanity();
}

document.addEventListener("mousedown", event => {
  if (
    event.button === 0 &&
    running &&
    document.pointerLockElement === renderer?.domElement
  ) {
    fire();
  }
});

// ===========================================
// SANITY AND WENDIGO
// ===========================================

function updateSanity() {
  $("sanityFill").style.width = sanity + "%";
  $("sanityNumber").textContent = Math.round(sanity) + "%";

  $("sanityFill").style.background =
    sanity < 30 ? "#a33c32" : "#a3b58e";

  if (sanity <= 0 && role === "hunter") transformIntoWendigo();
}

function transformIntoWendigo() {
  if (role === "wendigo") return;

  role = "wendigo";

  say("roleLabel", "ROLE: WENDIGO");
  say("objective", "HUNT EVERYONE IN THE FOREST.");
  notify("YOU ARE NO LONGER HUMAN");

  scene.background = new THREE.Color(0x170605);
  scene.fog = new THREE.FogExp2(0x170605, .035);

  if (wendigoTemplate) {
    wendigoInstance = wendigoTemplate.clone(true);
    scene.add(wendigoInstance);
  }
}

function updateWendigo() {
  if (!wendigoInstance) return;

  wendigoInstance.position.set(
    camera.position.x,
    0,
    camera.position.z - 3
  );

  wendigoInstance.rotation.y = yaw + Math.PI;
}

// ===========================================
// GAME LOOP
// ===========================================

function animate() {
  if (!running) return;

  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), .05);

  movePlayer(delta);
  updateAnimals(delta);
  updateWendigo();

  if (role === "hunter") {
    sanityTimer += delta;

    if (sanityTimer >= 5) {
      sanityTimer = 0;
      sanity = Math.max(0, sanity - 1);
      updateSanity();
    }
  }

  for (const player of players.values()) {
    // Position is updated from multiplayer messages.
    player.mesh.position.y = 0;
  }

  if (channel && Date.now() - lastSend > 100) {
    lastSend = Date.now();

    channel.send({
      type: "broadcast",
      event: "position",
      payload: {
        id: user.id,
        x: camera.position.x,
        z: camera.position.z
      }
    });
  }

  renderer.render(scene, camera);
}

// ===========================================
// CLEANUP
// ===========================================

function resize() {
  if (!camera || !renderer) return;

  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

$("leave").onclick = leaveGame;

async function leaveGame() {
  running = false;

  if (channel) {
    await supabase.removeChannel(channel);
    channel = null;
  }

  document.exitPointerLock?.();

  document.removeEventListener("mousemove", mouseLook);
  document.removeEventListener("mousedown", fire);

  if (renderer) {
    renderer.dispose();
    renderer.domElement.remove();
  }

  players.clear();
  animals.length = 0;

  scene = null;
  camera = null;
  renderer = null;

  $("gameScreen").classList.add("hidden");
  $("lobby").classList.remove("hidden");
  say("message", "");
}
unt.';$('playerCount').textContent=all.length+(all.length===1?' PLAYER':' PLAYERS');
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
