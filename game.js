
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

// ==========================================
// SUPABASE CONFIGURATION
// ==========================================

const SUPABASE_URL = "https://twsyqidzbgwidjnffhfb.supabase.co";
const SUPABASE_KEY = "sb_publishable_jkNeW0TBQTZ8VcEAudYAbw_xOt5ZVuQ";

const supabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

let user = null;
let channel = null;
let room = "FOREST";
let playerName = "Ranger";
let myRole = "hunter";
let sanity = 100;
let players = {};
let joinedAt = Date.now();
let caughtPlayers = new Set();

// ==========================================
// AUTHENTICATION
// ==========================================

const $ = id => document.getElementById(id);

$("signup").onclick = async () => {
  const { data, error } = await supabase.auth.signUp({
    email: $("email").value,
    password: $("password").value
  });

  $("authMessage").textContent = error
    ? error.message
    : "Account created. Check your email if confirmation is enabled.";
};

$("signin").onclick = async () => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: $("email").value,
    password: $("password").value
  });

  if (error) {
    $("authMessage").textContent = error.message;
    return;
  }

  user = data.user;
  $("login").classList.add("hidden");
  $("lobby").classList.remove("hidden");
};

$("logout").onclick = async () => {
  await supabase.auth.signOut();
  location.reload();
};

async function restoreSession() {
  const { data } = await supabase.auth.getSession();

  if (data.session) {
    user = data.session.user;
    $("login").classList.add("hidden");
    $("lobby").classList.remove("hidden");
  }
}

restoreSession();

// ==========================================
// THREE.JS WORLD
// ==========================================

const scene = new THREE.Scene();

scene.background = new THREE.Color(0x859087);
scene.fog = new THREE.FogExp2(0x859087, 0.009);

const camera = new THREE.PerspectiveCamera(
  75,
  innerWidth / innerHeight,
  0.1,
  400
);

camera.position.set(0, 1.7, 10);

const renderer = new THREE.WebGLRenderer({
  antialias: true
});

renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

$("game").appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(
  0xc7d3d0,
  0x293326,
  2
));

const sun = new THREE.DirectionalLight(0xffe4bb, 2);
sun.position.set(-40, 70, 35);
sun.castShadow = true;
scene.add(sun);

// ==========================================
// MATERIALS
// ==========================================

const material = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    ...extra
  });

const materials = {
  ground: material(0x46513a),
  trunk: material(0x493729),
  leaves: material(0x263d2c),
  leaves2: material(0x354c34),
  road: material(0x655e4c),
  cabin: material(0x544333),
  roof: material(0x292c29),
  deer: material(0x97724d),
  pale: material(0xc2bca7),
  black: material(0x191b18),
  eye: material(0xff291c, {
    emissive: 0xff1200,
    emissiveIntensity: 2
  })
};

// ==========================================
// WORLD OBJECTS
// ==========================================

function addBox(w, h, d, mat, x, y, z) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    mat
  );

  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  return mesh;
}

function addTree(x, z, height) {
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(.35, .6, height, 6),
    materials.trunk
  );

  trunk.position.set(x, height / 2, z);
  trunk.castShadow = true;
  scene.add(trunk);

  const leaves = new THREE.Mesh(
    new THREE.ConeGeometry(3, height * .8, 6),
    materials.leaves
  );

  leaves.position.set(x, height * .85, z);
  leaves.castShadow = true;
  scene.add(leaves);

  const upper = new THREE.Mesh(
    new THREE.ConeGeometry(2.2, height * .6, 6),
    materials.leaves2
  );

  upper.position.set(x, height * 1.15, z);
  scene.add(upper);
}

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400),
  materials.ground
);

ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Roads
addBox(11, .08, 250, materials.road, 20, .04, 0);
addBox(140, .08, 9, materials.road, -40, .04, -35);

// Cabins
function makeCabin(x, z) {
  addBox(9, 4, 8, materials.cabin, x, 2, z);

  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(7, 3, 4),
    materials.roof
  );

  roof.position.set(x, 5, z);
  roof.rotation.y = Math.PI / 4;
  scene.add(roof);

  addBox(1.2, 2, .15, materials.black, x, 1, z + 4.1);

  const windowMat = material(0x9aa77e, {
    emissive: 0x323c20
  });

  addBox(1.1, 1.2, .12, windowMat, x + 3, 2.4, z + 4.1);
}

makeCabin(-30, -35);
makeCabin(-70, 15);
makeCabin(70, -70);
makeCabin(65, 70);

// Forest
let seed = 7823;

function random() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}

for (let i = 0; i < 430; i++) {
  const x = (random() - .5) * 330;
  const z = (random() - .5) * 330;

  // Keep spawn and main road clear
  if (Math.hypot(x, z) < 17) continue;
  if (Math.abs(x - 20) < 9) continue;

  addTree(x, z, 6 + random() * 8);
}

// ==========================================
// DEER MODELS
// ==========================================

function createDeer(isSkinwalker = false) {
  const group = new THREE.Group();
  const bodyMat = isSkinwalker
    ? materials.pale
    : materials.deer;

  function part(geometry, mat, x, y, z) {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  }

  // Body
  part(
    new THREE.BoxGeometry(.65, .65, 1.25),
    bodyMat, 0, 1.2, 0
  );

  // Neck and head
  part(
    new THREE.BoxGeometry(.28, .8, .3),
    bodyMat, 0, 1.75, -.45
  );

  part(
    new THREE.BoxGeometry(.4, .35, .5),
    bodyMat, 0, 2.15, -.6
  );

  // Legs
  for (const x of [-.23, .23]) {
    for (const z of [-.4, .4]) {
      part(
        new THREE.BoxGeometry(.11, .75, .11),
        materials.black,
        x, .48, z
      );
    }
  }

  // Tail
  part(
    new THREE.BoxGeometry(.13, .18, .2),
    materials.pale, 0, 1.4, .68
  );

  if (isSkinwalker) {
    // Glowing eyes
    for (const x of [-.18, .18]) {
      part(
        new THREE.SphereGeometry(.07, 6, 6),
        materials.eye,
        x, 2.18, -.87
      );
    }

    // Unnatural antlers
    for (const x of [-.2, .2]) {
      const antler = part(
        new THREE.CylinderGeometry(.025, .07, .9, 5),
        materials.black,
        x, 2.75, -.55
      );

      antler.rotation.z = x > 0 ? -.4 : .4;
    }
  }

  return group;
}

// AI wildlife
const wildlife = [];

for (let i = 0; i < 15; i++) {
  const deer = createDeer(false);

  const x = (random() - .5) * 100 + 35;
  const z = (random() - .5) * 100;

  deer.position.set(x, 0, z);
  deer.rotation.y = random() * Math.PI * 2;

  scene.add(deer);

  wildlife.push({
    mesh: deer,
    x,
    z,
    phase: random() * 10
  });
}

// ==========================================
// FIRST PERSON WEAPON
// ==========================================

const gun = new THREE.Group();
camera.add(gun);

const gunMaterial = material(0x343a34, {
  metalness: .4,
  roughness: .6
});

const gunBody = new THREE.Mesh(
  new THREE.BoxGeometry(.2, .17, .65),
  gunMaterial
);

gunBody.position.set(.35, -.3, -.65);
gun.add(gunBody);

const barrel = new THREE.Mesh(
  new THREE.CylinderGeometry(.04, .04, .5, 8),
  gunMaterial
);

barrel.rotation.x = Math.PI / 2;
barrel.position.set(.35, -.25, -.98);
gun.add(barrel);

const dartMaterial = material(0xc2d89e, {
  emissive: 0x4d5d32
});

// ==========================================
// MULTIPLAYER
// ==========================================

const remoteModels = {};
const remotePositions = {};

async function joinRoom() {
  if (!user) return;

  playerName = $("playerName").value.trim() || "Ranger";
  room = $("roomCode").value.trim().toUpperCase() || "FOREST";

  $("lobbyMessage").textContent = "Connecting to forest...";

  channel = supabase.channel("forest-" + room, {
    config: {
      broadcast: {
        self: false
      },
      presence: {
        key: user.id
      }
    }
  });

  channel
    .on("presence", { event: "sync" }, updatePresence)
    .on("broadcast", { event: "move" }, ({ payload }) => {
      if (payload.id === user.id) return;
      remotePositions[payload.id] = payload;
    })
    .on("broadcast", { event: "capture" }, ({ payload }) => {
      if (payload.target === user.id) {
        caughtPlayers.add(user.id);
        showMessage("YOU HAVE BEEN CAPTURED.");
      } else {
        showMessage(payload.name + " was captured.");
      }
      if (myRole === "hunter") {
        sanity = Math.min(100, sanity + 25);
      }
    })
    .on("broadcast", { event: "round_end" }, ({ payload }) => {
      endRound(payload.winner);
    });

  const status = await new Promise(resolve => {
    channel.subscribe(status => resolve(status));
  });

  if (status !== "SUBSCRIBED") {
    $("lobbyMessage").textContent = "Connection failed. Try again.";
    return;
  }

  joinedAt = Date.now();

  await channel.track({
    id: user.id,
    name: playerName,
    joined: joinedAt,
    x: camera.position.x,
    z: camera.position.z,
    rot: 0,
    caught: false
  });

  $("lobby").classList.add("hidden");
  $("hud").classList.remove("hidden");

  $("roomDisplay").textContent = room;
  $("sanityName").textContent = playerName.toUpperCase() + " SANITY";

  document.getElementById("game").requestPointerLock?.();
  renderer.domElement.requestPointerLock();

  setTimeout(updatePresence, 500);
}

$("play").onclick = joinRoom;

function updatePresence() {
  if (!channel) return;

  const state = channel.presenceState();

  const all = [];

  for (const list of Object.values(state)) {
    for (const p of list) {
      if (p.id && !all.some(v => v.id === p.id)) {
        all.push(p);
      }
    }
  }

  all.sort((a, b) => a.joined - b.joined);

  // First player is hunter; others are skinwalker deer.
  const hunter = all[0];

  if (!hunter) return;

  myRole = hunter.id === user.id ? "hunter" : "deer";

  $("role").textContent =
    myRole === "hunter" ? "HUNTER" : "SKINWALKER DEER";

  $("objective").textContent =
    myRole === "hunter"
      ? "Find the deer that doesn't belong."
      : "Blend in. Survive the hunt.";

  $("playerCount").textContent =
    all.length + (all.length === 1 ? " PLAYER" : " PLAYERS");

  for (const p of all) {
    if (p.id === user.id) continue;

    if (!remoteModels[p.id]) {
      const deer = createDeer(p.id !== hunter.id);
      scene.add(deer);
      remoteModels[p.id] = deer;
    }
  }

  for (const id of Object.keys(remoteModels)) {
    if (!all.some(p => p.id === id)) {
      scene.remove(remoteModels[id]);
      delete remoteModels[id];
      delete remotePositions[id];
    }
  }
}

// ==========================================
// PLAYER INPUT
// ==========================================

const keys = {};
let yaw = 0;
let pitch = 0;
let locked = false;
let lastMove = 0;

document.addEventListener("keydown", e => {
  keys[e.code] = true;
});

document.addEventListener("keyup", e => {
  keys[e.code] = false;
});

document.addEventListener("pointerlockchange", () => {
  locked = document.pointerLockElement === renderer.domElement;
});

document.addEventListener("mousemove", e => {
  if (!locked) return;

  yaw -= e.movementX * .002;
  pitch -= e.movementY * .002;

  pitch = Math.max(-1.3, Math.min(1.3, pitch));
});

renderer.domElement.addEventListener("click", () => {
  if (!locked) renderer.domElement.requestPointerLock();
});

document.addEventListener("mousedown", e => {
  if (e.button === 0 && locked && myRole === "hunter") {
    fireDart();
  }
});

// ==========================================
// CAPTURE SYSTEM
// ==========================================

const raycaster = new THREE.Raycaster();
let lastShot = 0;

function fireDart() {
  if (Date.now() - lastShot < 700) return;
  lastShot = Date.now();

  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);

  const dart = new THREE.Mesh(
    new THREE.SphereGeometry(.06, 6, 6),
    dartMaterial
  );

  dart.position.copy(camera.position);
  scene.add(dart);

  const targets = [];

  for (const [id, mesh] of Object.entries(remoteModels)) {
    targets.push({ id, mesh });
  }

  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

  const hits = raycaster.intersectObjects(
    targets.map(t => t.mesh),
    true
  );

  let target = null;

  if (hits.length) {
    target = targets.find(t =>
      hits[0].object === t.mesh ||
      t.mesh.getObjectById(hits[0].object.id)
    );
  }

  if (target) {
    const position = remotePositions[target.id];

    if (position) {
      const distance = Math.hypot(
        camera.position.x - position.x,
        camera.position.z - position.z
      );

      if (distance <= 22) {
        channel.send({
          type: "broadcast",
          event: "capture",
          payload: {
            target: target.id,
            name: target.id
          }
        });

        showMessage("DART CONNECTED!");
      }
    }
  }

  const start = camera.position.clone();
  const end = start.clone().addScaledVector(direction, 35);

  dart.position.copy(end);
  setTimeout(() => scene.remove(dart), 250);
}

// ==========================================
// HUD
// ==========================================

let messageTimer = 0;

function showMessage(text) {
  $("message").textContent = text;
  $("message").style.opacity = 1;
  messageTimer = 2.5;
}

function endRound(winner) {
  $("resultTitle").textContent =
    winner === "hunter" ? "HUNTER VICTORY" : "SKINWALKERS WIN";

  $("resultMessage").textContent =
    winner === "hunter"
      ? "Every skinwalker was captured."
      : "The forest kept its secrets.";

  $("result").classList.remove("hidden");
}

// ==========================================
// MAIN GAME LOOP
// ==========================================

let previousTime = performance.now();
let sanityTimer = 0;

function animate(now) {
  requestAnimationFrame(animate);

  const dt = Math.min((now - previousTime) / 1000, .05);
  previousTime = now;

  if (channel && user) {
    // Movement
    const forward =
      (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);

    const sideways =
      (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);

    const speed = (keys.ShiftLeft ? 10 : 6) * dt;

    camera.position.x +=
      (-Math.sin(yaw) * forward + Math.cos(yaw) * sideways) * speed;

    camera.position.z +=
      (-Math.cos(yaw) * forward - Math.sin(yaw) * sideways) * speed;

    camera.position.x = THREE.MathUtils.clamp(
      camera.position.x, -180, 180
    );

    camera.position.z = THREE.MathUtils.clamp(
      camera.position.z, -180, 180
    );

    camera.rotation.order = "YXZ";
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;

    // Broadcast position
    if (now - lastMove > 80) {
      channel.send({
        type: "broadcast",
        event: "move",
        payload: {
          id: user.id,
          x: camera.position.x,
          z: camera.position.z,
          rot: yaw,
          name: playerName
        }
      });

      lastMove = now;
    }

    // Sanity
    if (myRole === "hunter") {
      sanity = Math.max(0, sanity - dt * .75);
    }

    $("sanityNumber").textContent = Math.round(sanity) + "%";
    $("sanityFill").style.width = sanity + "%";

    $("sanityFill").style.background =
      sanity < 25 ? "#b74b3f" :
      sanity < 50 ? "#c4a16b" : "#a8c28e";

    if (sanity <= 0 && myRole === "hunter") {
      $("objective").textContent =
        "YOUR MIND IS BREAKING. TRUST NOTHING.";
      scene.fog.density = .02;
    }

    // Animate remote players
    for (const [id, mesh] of Object.entries(remoteModels)) {
      const p = remotePositions[id];
      if (!p) continue;

      mesh.position.x = THREE.MathUtils.lerp(
        mesh.position.x, p.x, .18
      );

      mesh.position.z = THREE.MathUtils.lerp(
        mesh.position.z, p.z, .18
      );

      mesh.rotation.y = p.rot || 0;
    }

    // AI deer wandering
    for (const deer of wildlife) {
      deer.phase += dt * .4;

      deer.mesh.position.x =
        deer.x + Math.sin(deer.phase) * 2;

      deer.mesh.position.z =
        deer.z + Math.cos(deer.phase * .7) * 2;

      deer.mesh.rotation.y = Math.sin(deer.phase) * .7;
    }

    if (messageTimer > 0) {
      messageTimer -= dt;
      if (messageTimer <= 0) {
        $("message").style.opacity = 0;
      }
    }
  }

  renderer.render(scene, camera);
}

requestAnimationFrame(animate);

// ==========================================
// RESIZE
// ==========================================

window.addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(innerWidth, innerHeight);
});
