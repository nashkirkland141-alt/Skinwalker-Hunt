
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

// ========================================
// SKINWALKER: THE HUNT
// ========================================

const CONFIG = {
  forest: "./assets/forest.glb",
  deer: "./assets/low_poly_deer_elk.glb",
  wendigo: "./assets/wendigo.glb",

  playerSpeed: 5,
  deerSpeed: 4,
  mouseSensitivity: 0.002,
  sanityDrain: 1.5,
  captureDistance: 35,
  broadcastRate: 80
};

const $ = id => document.getElementById(id);

const menu = $("menu");
const gameContainer = $("game");
const hud = $("hud");
const statusText = $("status");
const sanityFill = $("sanity-fill");
const blackout = $("blackout");

let scene, camera, renderer, clock;
let loader;

let currentUser = null;
let currentRole = "hunter";
let currentRoom = "";
let roomChannel = null;

let player = {
  position: new THREE.Vector3(0, 1.7, 0),
  yaw: 0,
  pitch: 0,
  sanity: 100,
  health: 100,
  speed: CONFIG.playerSpeed
};

let keys = {};
let remotePlayers = new Map();
let aiDeer = [];
let forestLoaded = false;
let gameRunning = false;
let lastBroadcast = 0;
let lastFrame = 0;
let isPointerLocked = false;
let isTransformed = false;
let wendigoModel = null;
let deerModel = null;

const raycaster = new THREE.Raycaster();
const forward = new THREE.Vector3();
const moveDirection = new THREE.Vector3();

let mobileInput = { x: 0, y: 0 };
let joystickPointer = null;
let lookPointer = null;
let lastTouchX = 0;
let lastTouchY = 0;

// ========================================
// AUTH
// ========================================

async function initializeAuth() {
  try {
    if (!window.Auth) {
      throw new Error("config.js did not load. Check your script order.");
    }

    await window.Auth.initialize();

    currentUser = await window.Auth.getUser();

    if (currentUser) {
      showLobby();
    }
  } catch (error) {
    setStatus(error.message || "Could not initialize authentication.");
  }
}

function setStatus(message) {
  statusText.textContent = message || "";
}

function showLobby() {
  $("auth-area").style.display = "none";
  $("lobby-area").style.display = "block";
  $("welcome").textContent = `Signed in as ${currentUser.email}`;
  setStatus("Choose your role and enter a room.");
}

$("login-button").addEventListener("click", async () => {
  const email = $("email").value.trim();
  const password = $("password").value;

  if (!email || !password) {
    setStatus("Enter your email and password.");
    return;
  }

  setStatus("Signing in...");

  try {
    currentUser = await window.Auth.login(email, password);
    showLobby();
  } catch (error) {
    setStatus(error.message || "Login failed.");
  }
});

$("signup-button").addEventListener("click", async () => {
  const email = $("email").value.trim();
  const password = $("password").value;

  if (!email || !password) {
    setStatus("Enter your email and password.");
    return;
  }

  if (password.length < 6) {
    setStatus("Password must be at least 6 characters.");
    return;
  }

  setStatus("Creating account...");

  try {
    const result = await window.Auth.signup(email, password);

    if (result.session) {
      currentUser = result.user;
      showLobby();
    } else {
      setStatus(result.message || "Check your email to confirm your account.");
    }
  } catch (error) {
    setStatus(error.message || "Signup failed.");
  }
});

$("logout-button").addEventListener("click", async () => {
  try {
    await window.Auth.logout();
    currentUser = null;

    $("auth-area").style.display = "block";
    $("lobby-area").style.display = "none";

    setStatus("Signed out.");
  } catch (error) {
    setStatus(error.message || "Sign out failed.");
  }
});

// ========================================
// ROLE SELECTION
// ========================================

function chooseRole(role) {
  currentRole = role;

  $("hunter-role").classList.toggle("selected", role === "hunter");
  $("deer-role").classList.toggle("selected", role === "deer");
}

$("hunter-role").addEventListener("click", () => chooseRole("hunter"));
$("deer-role").addEventListener("click", () => chooseRole("deer"));

// ========================================
// ROOM SETUP
// ========================================

function createRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

async function connectRoom() {
  const client = window.supabaseClient;

  if (!client) {
    throw new Error("Supabase client was not initialized.");
  }

  const enteredCode = $("room-code").value.trim().toUpperCase();
  currentRoom = enteredCode || createRoomCode();

  roomChannel = client.channel(`hunt-room-${currentRoom}`, {
    config: {
      presence: {
        key: currentUser.id
      },
      broadcast: {
        self: false
      }
    }
  });

  roomChannel.on("presence", { event: "sync" }, updatePresence);

  roomChannel.on("broadcast", { event: "player-state" }, payload => {
    updateRemotePlayer(payload.payload);
  });

  roomChannel.on("broadcast", { event: "shot" }, payload => {
    showRemoteShot(payload.payload);
  });

  roomChannel.on("broadcast", { event: "capture" }, payload => {
    handleRemoteCapture(payload.payload);
  });

  await new Promise((resolve, reject) => {
    roomChannel.subscribe(async status => {
      if (status === "SUBSCRIBED") {
        try {
          await roomChannel.track({
            id: currentUser.id,
            name: currentUser.email.split("@")[0],
            role: currentRole,
            x: player.position.x,
            y: player.position.y,
            z: player.position.z,
            yaw: player.yaw
          });

          resolve();
        } catch (error) {
          reject(error);
        }
      }

      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        reject(new Error("Could not connect to room."));
      }
    });
  });
}

function updatePresence() {
  if (!roomChannel) return;

  const state = roomChannel.presenceState();
  const seen = new Set();

  for (const [userId, entries] of Object.entries(state)) {
    if (userId === currentUser.id) continue;

    const data = entries[0];
    if (!data) continue;

    seen.add(userId);

    if (!remotePlayers.has(userId)) {
      createRemotePlayer(userId, data);
    }

    updateRemotePlayer({
      id: userId,
      ...data
    });
  }

  for (const [id, remote] of remotePlayers) {
    if (!seen.has(id)) {
      scene.remove(remote.group);
      remotePlayers.delete(id);
    }
  }
}

// ========================================
// THREE.JS SETUP
// ========================================

function setupScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x89928a);
  scene.fog = new THREE.FogExp2(0x394438, 0.018);

  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );

  camera.rotation.order = "YXZ";
  camera.position.copy(player.position);

  renderer = new THREE.WebGLRenderer({
    antialias: true
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  gameContainer.innerHTML = "";
  gameContainer.appendChild(renderer.domElement);

  clock = new THREE.Clock();
  loader = new GLTFLoader();

  const ambient = new THREE.HemisphereLight(
    0xc4d2bd,
    0x172016,
    1.1
  );
  scene.add(ambient);

  const moon = new THREE.DirectionalLight(0xd0d9cf, 1.4);
  moon.position.set(-30, 50, -20);
  moon.castShadow = true;
  scene.add(moon);

  createGround();
  createAtmosphere();

  window.addEventListener("resize", onResize);
}

function createGround() {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1000, 1000),
    new THREE.MeshStandardMaterial({
      color: 0x263324,
      roughness: 1
    })
  );

  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.1;
  ground.receiveShadow = true;
  scene.add(ground);
}

function createAtmosphere() {
  const count = 500;
  const positions = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - .5) * 300;
    positions[i * 3 + 1] = Math.random() * 35;
    positions[i * 3 + 2] = (Math.random() - .5) * 300;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3)
  );

  const particles = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: 0xb9c3a8,
      size: .09,
      transparent: true,
      opacity: .35
    })
  );

  scene.add(particles);
}

// ========================================
// FOREST AND MODELS
// ========================================

async function loadModel(path) {
  return new Promise((resolve, reject) => {
    loader.load(
      path,
      gltf => resolve(gltf.scene),
      undefined,
      error => reject(error)
    );
  });
}

async function loadForest() {
  try {
    const forest = await loadModel(CONFIG.forest);

    forest.scale.setScalar(1);
    forest.position.set(0, 0, 0);

    forest.traverse(object => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });

    scene.add(forest);
    forestLoaded = true;
    console.log("Forest loaded.");
  } catch (error) {
    console.warn("Forest model could not load. Using fallback trees.", error);
    createFallbackForest();
  }
}

function createFallbackForest() {
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x35271c });
  const leafMaterial = new THREE.MeshStandardMaterial({ color: 0x17291b });

  for (let i = 0; i < 140; i++) {
    const x = (Math.random() - .5) * 180;
    const z = (Math.random() - .5) * 180;

    if (Math.abs(x) < 8 && Math.abs(z) < 8) continue;

    const height = 5 + Math.random() * 7;

    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(.3, .55, height, 6),
      trunkMaterial
    );

    trunk.position.set(x, height / 2, z);
    trunk.castShadow = true;
    scene.add(trunk);

    const leaves = new THREE.Mesh(
      new THREE.ConeGeometry(2 + Math.random() * 2, height * .75, 6),
      leafMaterial
    );

    leaves.position.set(x, height * .85, z);
    leaves.castShadow = true;
    scene.add(leaves);
  }
}

async function loadCharacters() {
  try {
    deerModel = await loadModel(CONFIG.deer);
    normalizeModel(deerModel, 2.2);
    createAIDeer();
  } catch (error) {
    console.warn("Deer model unavailable. Using simple deer shapes.", error);
    createAIDeerFallback();
  }

  try {
    wendigoModel = await loadModel(CONFIG.wendigo);
    normalizeModel(wendigoModel, 3.5);
  } catch (error) {
    console.warn("Wendigo model unavailable.", error);
  }
}

function normalizeModel(model, targetHeight) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());

  if (size.y > 0) {
    model.scale.multiplyScalar(targetHeight / size.y);
  }

  const newBox = new THREE.Box3().setFromObject(model);
  model.position.y -= newBox.min.y;
}

function createAIDeer() {
  if (!deerModel) return;

  for (let i = 0; i < 12; i++) {
    const deer = deerModel.clone(true);

    const angle = Math.random() * Math.PI * 2;
    const distance = 15 + Math.random() * 65;

    deer.position.set(
      Math.cos(angle) * distance,
      0,
      Math.sin(angle) * distance
    );

    deer.rotation.y = Math.random() * Math.PI * 2;
    deer.userData.isAI = true;
    deer.userData.captured = false;
    deer.userData.target = deer.position.clone();

    scene.add(deer);
    aiDeer.push(deer);
  }
}

function createAIDeerFallback() {
  const material = new THREE.MeshStandardMaterial({ color: 0x8b6844 });

  for (let i = 0; i < 12; i++) {
    const deer = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, .8, .6),
      material
    );
    body.position.y = 1.2;
    deer.add(body);

    const head = new THREE.Mesh(
      new THREE.BoxGeometry(.5, .6, .5),
      material
    );
    head.position.set(.8, 1.65, 0);
    deer.add(head);

    deer.position.set(
      (Math.random() - .5) * 100,
      0,
      (Math.random() - .5) * 100
    );

    deer.userData.isAI = true;
    deer.userData.captured = false;
    deer.userData.target = deer.position.clone();

    scene.add(deer);
    aiDeer.push(deer);
  }
}

// ========================================
// REMOTE PLAYERS
// ========================================

function createRemotePlayer(id, data) {
  const group = new THREE.Group();

  const material = new THREE.MeshStandardMaterial({
    color: data.role === "deer" ? 0x92734e : 0x354538
  });

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(.4, 1, 4, 8),
    material
  );

  body.position.y = 1;
  group.add(body);

  group.position.set(data.x || 0, 0, data.z || 0);
  scene.add(group);

  remotePlayers.set(id, {
    group,
    role: data.role || "hunter",
    target: new THREE.Vector3(data.x || 0, 0, data.z || 0),
    yaw: data.yaw || 0
  });
}

function updateRemotePlayer(data) {
  if (!data || !data.id || data.id === currentUser.id) return;

  let remote = remotePlayers.get(data.id);

  if (!remote) {
    createRemotePlayer(data.id, data);
    remote = remotePlayers.get(data.id);
  }

  if (!remote) return;

  remote.target.set(
    Number(data.x) || 0,
    0,
    Number(data.z) || 0
  );

  remote.yaw = Number(data.yaw) || 0;
  remote.role = data.role || remote.role;
}

function showRemoteShot(data) {
  if (!data) return;

  const start = new THREE.Vector3(data.x, 1.5, data.z);
  const end = new THREE.Vector3(data.tx, 1.5, data.tz);

  createShotEffect(start, end);
}

function handleRemoteCapture(data) {
  if (!data || !data.id) return;

  const remote = remotePlayers.get(data.id);
  if (remote) {
    remote.group.visible = false;
  }
}

// ========================================
// PLAYER CONTROLS
// ========================================

function setupControls() {
  document.addEventListener("keydown", event => {
    keys[event.code] = true;
  });

  document.addEventListener("keyup", event => {
    keys[event.code] = false;
  });

  renderer.domElement.addEventListener("click", () => {
    if (window.innerWidth > 700 && gameRunning) {
      renderer.domElement.requestPointerLock();
    }
  });

  document.addEventListener("pointerlockchange", () => {
    isPointerLocked = document.pointerLockElement === renderer.domElement;
  });

  document.addEventListener("mousemove", event => {
    if (!isPointerLocked || !gameRunning) return;

    player.yaw -= event.movementX * CONFIG.mouseSensitivity;
    player.pitch -= event.movementY * CONFIG.mouseSensitivity;

    player.pitch = THREE.MathUtils.clamp(
      player.pitch,
      -1.45,
      1.45
    );
  });

  $("fire-button").addEventListener("pointerdown", event => {
    event.preventDefault();
    fireWeapon();
  });

  $("joystick").addEventListener("pointerdown", event => {
    joystickPointer = event.pointerId;
    $("joystick").setPointerCapture(event.pointerId);
    updateJoystick(event);
  });

  $("joystick").addEventListener("pointermove", event => {
    if (event.pointerId === joystickPointer) {
      updateJoystick(event);
    }
  });

  $("joystick").addEventListener("pointerup", resetJoystick);
  $("joystick").addEventListener("pointercancel", resetJoystick);

  renderer.domElement.addEventListener("touchstart", event => {
    if (event.touches.length !== 1) return;

    const touch = event.touches[0];

    if (touch.clientX > window.innerWidth * .35) {
      lookPointer = touch.identifier;
      lastTouchX = touch.clientX;
      lastTouchY = touch.clientY;
    }
  }, { passive: true });

  renderer.domElement.addEventListener("touchmove", event => {
    if (lookPointer === null) return;

    for (const touch of event.touches) {
      if (touch.identifier !== lookPointer) continue;

      const dx = touch.clientX - lastTouchX;
      const dy = touch.clientY - lastTouchY;

      player.yaw -= dx * .004;
      player.pitch -= dy * .004;

      player.pitch = THREE.MathUtils.clamp(
        player.pitch,
        -1.45,
        1.45
      );

      lastTouchX = touch.clientX;
      lastTouchY = touch.clientY;
    }
  }, { passive: true });

  renderer.domElement.addEventListener("touchend", event => {
    for (const touch of event.changedTouches) {
      if (touch.identifier === lookPointer) {
        lookPointer = null;
      }
    }
  });
}

function updateJoystick(event) {
  const rect = $("joystick").getBoundingClientRect();

  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  let dx = event.clientX - centerX;
  let dy = event.clientY - centerY;

  const distance = Math.sqrt(dx * dx + dy * dy);
  const maxDistance = 38;

  if (distance > maxDistance) {
    dx = dx / distance * maxDistance;
    dy = dy / distance * maxDistance;
  }

  mobileInput.x = dx / maxDistance;
  mobileInput.y = dy / maxDistance;

  $("stick").style.transform = `translate(${dx}px, ${dy}px)`;
}

function resetJoystick() {
  joystickPointer = null;
  mobileInput.x = 0;
  mobileInput.y = 0;
  $("stick").style.transform = "translate(0,0)";
}

function updateMovement(delta) {
  const inputX =
    (keys.KeyD ? 1 : 0) -
    (keys.KeyA ? 1 : 0) +
    mobileInput.x;

  const inputZ =
    (keys.KeyS ? 1 : 0) -
    (keys.KeyW ? 1 : 0) +
    mobileInput.y;

  moveDirection.set(inputX, 0, inputZ);

  if (moveDirection.lengthSq() > 1) {
    moveDirection.normalize();
  }

  moveDirection.applyAxisAngle(
    new THREE.Vector3(0, 1, 0),
    player.yaw
  );

  player.position.addScaledVector(
    moveDirection,
    player.speed * delta
  );

  player.position.y = 1.7;

  camera.position.copy(player.position);
  camera.rotation.set(player.pitch, player.yaw, 0, "YXZ");
}

// ========================================
// TRANQUILIZER WEAPON
// ========================================

function fireWeapon() {
  if (!gameRunning || currentRole !== "hunter") return;

  forward.set(0, 0, -1).applyQuaternion(camera.quaternion);

  const start = camera.position.clone();
  const end = start.clone().add(forward.multiplyScalar(CONFIG.captureDistance));

  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

  const targets = [
    ...aiDeer.filter(deer => !deer.userData.captured),
    ...Array.from(remotePlayers.values())
      .filter(remote => remote.role === "deer")
      .map(remote => remote.group)
  ];

  const hits = raycaster.intersectObjects(targets, true);

  if (hits.length > 0) {
    const hitObject = hits[0].object;

    let target = hitObject;

    while (target && !target.userData.isAI && target.parent) {
      target = target.parent;
    }

    const aiTarget = aiDeer.find(deer =>
      deer === target || deer === hitObject || deer.getObjectById(hitObject.id)
    );

    if (aiTarget) {
      captureAIDeer(aiTarget);
    } else {
      captureRemoteDeer(hitObject);
    }

    createShotEffect(start, hits[0].point);
  } else {
    createShotEffect(start, end);
  }

  if (roomChannel) {
    roomChannel.send({
      type: "broadcast",
      event: "shot",
      payload: {
        x: player.position.x,
        z: player.position.z,
        tx: end.x,
        tz: end.z
      }
    });
  }
}

function captureAIDeer(deer) {
  if (deer.userData.captured) return;

  deer.userData.captured = true;

  const material = new THREE.MeshStandardMaterial({
    color: 0x4b2924
  });

  deer.traverse(object => {
    if (object.isMesh) {
      object.material = material;
    }
  });

  // Capturing AI deer reduces sanity.
  player.sanity = Math.max(0, player.sanity - 12);
  updateSanity();
}

function captureRemoteDeer(object) {
  let foundId = null;

  for (const [id, remote] of remotePlayers) {
