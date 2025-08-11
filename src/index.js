import { createGL, createProgram, createTexture, createFBO } from './utils/gl';
import quadVS from './shaders/quad.vs';
import decayFS from './shaders/decay.fs';
import copyFS from './shaders/copy.fs';
import particlesVS from './shaders/particles.vs';
import particlesFS from './shaders/particles.fs';
import particles2dVS from './shaders/particles2d.vs';
import glassVS from './shaders/glass.vs';
import glassFS from './shaders/glass.fs';
import vaporVS from './shaders/vapor.vs';
import vaporFS from './shaders/vapor.fs';
import edgeVS from './shaders/edge.vs';
import edgeFS from './shaders/edge.fs';
import updateVS from './shaders/update.vs';
import updateFS from './shaders/update.fs';
import { M4 } from './utils/m4';


// --- simulation parameters
// With GPU transform feedback we can support tens of thousands of particles
// without touching them on the CPU each frame.
let MAX_PARTICLES = 30000;
const DT_MAX = 1 / 30;
const BOUNDS = 20;
const DENS_RES = 128;

// track characteristics for each isotope
const ISOTOPES = {
  'Ambient (α+β)': {
    mix: [
      { type: 'alpha', frac: 0.30, speed: 2.2, life: 3.5, size: 26, bright: 1.05, qScale: 1.0 },
      { type: 'beta', frac: 0.70, speed: 7.0, life: 7.0, size: 10, bright: 0.65, qScale: 1.0 }
    ]
  },
  'Am-241 (α)': { mix: [{ type: 'alpha', frac: 1.0, speed: 2.1, life: 3.8, size: 28, bright: 1.15, qScale: 0.8 }] },
  'Po-210 (α)': { mix: [{ type: 'alpha', frac: 1.0, speed: 2.0, life: 3.4, size: 28, bright: 1.20, qScale: 0.8 }] },
  'Rn-222 (α)': { mix: [{ type: 'alpha', frac: 1.0, speed: 2.0, life: 3.2, size: 26, bright: 1.10, qScale: 0.85 }] },
  'Sr-90 (β−)': { mix: [{ type: 'beta', frac: 1.0, speed: 6.5, life: 7.5, size: 9, bright: 0.60, qScale: 1.2 }] },
  'Cs-137 (β−)': { mix: [{ type: 'beta', frac: 1.0, speed: 7.5, life: 8.0, size: 10, bright: 0.62, qScale: 1.2 }] },
  'Co-60 (β−)': { mix: [{ type: 'beta', frac: 1.0, speed: 5.5, life: 6.8, size: 9, bright: 0.60, qScale: 1.1 }] },
  'Th-232 chain (α+β)': {
    mix: [
      { type: 'alpha', frac: 0.60, speed: 2.0, life: 3.5, size: 27, bright: 1.10, qScale: 0.85 },
      { type: 'beta', frac: 0.40, speed: 6.8, life: 7.5, size: 10, bright: 0.62, qScale: 1.15 }
    ]
  },
  'Cosmic Muons (μ)': { cosmic: true }
};

function pickComp(mix) {
  const r = Math.random();
  let a = 0;
  for (const c of mix) {
    a += c.frac;
    if (r <= a) return c;
  }
  return mix[mix.length - 1];
}

const canvas = document.createElement('canvas');
document.getElementById('app').appendChild(canvas);
const gl = createGL(canvas);
const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
if (!isWebGL2) {
  // CPU fallback can't handle as many particles
  MAX_PARTICLES = 10000;
}

// --- create fullscreen quad programs
const quadProg = createProgram(gl, quadVS, copyFS);
const decayProg = createProgram(gl, quadVS, decayFS);

// --- create particle program
const pProg = createProgram(gl, particlesVS, particlesFS);
const p2dProg = createProgram(gl, particles2dVS, particlesFS);

// --- glass cube and vapor programs
const glassProg = createProgram(gl, glassVS, glassFS);
const vaporProg = createProgram(gl, vaporVS, vaporFS);
const edgeProg = createProgram(gl, edgeVS, edgeFS);
// --- particle update program (transform feedback, WebGL2 only)
let updateProg = null;
if (isWebGL2) {
  updateProg = createProgram(gl, updateVS, updateFS, {}, ['v_state1', 'v_state2', 'v_state3']);
}

// --- common geometry buffers
const quadVBO = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

// cube: 12 edges (24 vertices)
// glass cube geometry (36 verts with normals)
const glassVBO = gl.createBuffer();
const b = BOUNDS;
const GV = [
  // front
  -b, -b, b, 0, 0, 1,
  b, -b, b, 0, 0, 1,
  b, b, b, 0, 0, 1,
  -b, -b, b, 0, 0, 1,
  b, b, b, 0, 0, 1,
  -b, b, b, 0, 0, 1,
  // back
  -b, -b, -b, 0, 0, -1,
  -b, b, -b, 0, 0, -1,
  b, b, -b, 0, 0, -1,
  -b, -b, -b, 0, 0, -1,
  b, b, -b, 0, 0, -1,
  b, -b, -b, 0, 0, -1,
  // left
  -b, -b, -b, -1, 0, 0,
  -b, -b, b, -1, 0, 0,
  -b, b, b, -1, 0, 0,
  -b, -b, -b, -1, 0, 0,
  -b, b, b, -1, 0, 0,
  -b, b, -b, -1, 0, 0,
  // right
  b, -b, -b, 1, 0, 0,
  b, b, -b, 1, 0, 0,
  b, b, b, 1, 0, 0,
  b, -b, -b, 1, 0, 0,
  b, b, b, 1, 0, 0,
  b, -b, b, 1, 0, 0,
  // top
  -b, b, -b, 0, 1, 0,
  -b, b, b, 0, 1, 0,
  b, b, b, 0, 1, 0,
  -b, b, -b, 0, 1, 0,
  b, b, b, 0, 1, 0,
  b, b, -b, 0, 1, 0,
  // bottom
  -b, -b, -b, 0, -1, 0,
  b, -b, -b, 0, -1, 0,
  b, -b, b, 0, -1, 0,
  -b, -b, -b, 0, -1, 0,
  b, -b, b, 0, -1, 0,
  -b, -b, b, 0, -1, 0
];
gl.bindBuffer(gl.ARRAY_BUFFER, glassVBO);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(GV), gl.STATIC_DRAW);

// edge lines for glass cube
const edgeVBO = gl.createBuffer();
const EV = [
  // bottom square
  -b, -b, -b, b, -b, -b,
  b, -b, -b, b, -b, b,
  b, -b, b, -b, -b, b,
  -b, -b, b, -b, -b, -b,
  // top square
  -b, b, -b, b, b, -b,
  b, b, -b, b, b, b,
  b, b, b, -b, b, b,
  -b, b, b, -b, b, -b,
  // vertical edges
  -b, -b, -b, -b, b, -b,
  b, -b, -b, b, b, -b,
  b, -b, b, b, b, b,
  -b, -b, b, -b, b, b
];
gl.bindBuffer(gl.ARRAY_BUFFER, edgeVBO);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(EV), gl.STATIC_DRAW);

// vapor volume slices
const VAPOR_SLICES = 96;
const vaporVBO = gl.createBuffer();
(function initVapor() {
  const verts = [];
  for (let i = 0; i < VAPOR_SLICES; i++) {
    const z = -BOUNDS + (2 * BOUNDS) * (i / (VAPOR_SLICES - 1));
    verts.push(
      -b, -b, z, b, -b, z, b, b, z,
      -b, -b, z, b, b, z, -b, b, z
    );
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, vaporVBO);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
})();

// accumulation buffers
let texA, texB, fboA, fboB, W = 2, H = 2, DPR = 1;
let densTexA, densTexB, densFboA, densFboB;
function createTargets(w, h) {
  texA && gl.deleteTexture(texA);
  texB && gl.deleteTexture(texB);
  fboA && gl.deleteFramebuffer(fboA);
  fboB && gl.deleteFramebuffer(fboB);
  texA = createTexture(gl, w, h);
  texB = createTexture(gl, w, h);
  fboA = createFBO(gl, texA);
  fboB = createFBO(gl, texB);
  clearTargets();
}
function clearTargets() {
  gl.disable(gl.BLEND);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fboA);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fboB);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  if (densFboA) clearDensityTargets();
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function createDensityTargets() {
  densTexA && gl.deleteTexture(densTexA);
  densTexB && gl.deleteTexture(densTexB);
  densFboA && gl.deleteFramebuffer(densFboA);
  densFboB && gl.deleteFramebuffer(densFboB);
  densTexA = createTexture(gl, DENS_RES, DENS_RES);
  densTexB = createTexture(gl, DENS_RES, DENS_RES);
  densFboA = createFBO(gl, densTexA);
  densFboB = createFBO(gl, densTexB);
  clearDensityTargets();
}
function clearDensityTargets() {
  gl.disable(gl.BLEND);
  gl.bindFramebuffer(gl.FRAMEBUFFER, densFboA);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, densFboB);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(2, Math.floor(window.innerWidth * DPR));
  const h = Math.max(2, Math.floor(window.innerHeight * DPR));
  if (w === W && h === H) return;
  W = w; H = h;
  canvas.width = w; canvas.height = h;
  canvas.style.width = '100%'; canvas.style.height = '100%';
  gl.viewport(0, 0, w, h);
  createTargets(w, h);
}
window.addEventListener('resize', resize);
resize();
createDensityTargets();

// --- camera
let camYaw = 1.2, camPitch = 0.2, camDist = 64.0;
let isDragging = false, lastX = 0, lastY = 0;
let isPinching = false, lastPinch = 0;
let userPanned = false;
canvas.addEventListener('mousedown', e => { isDragging = true; lastX = e.clientX; lastY = e.clientY; });
window.addEventListener('mouseup', () => isDragging = false);
window.addEventListener('mousemove', e => {
  if (!isDragging) return;
  const dx = (e.clientX - lastX) / window.innerWidth;
  const dy = (e.clientY - lastY) / window.innerHeight;
  camYaw += dx * 3.0;
  camPitch = Math.max(-1.2, Math.min(1.2, camPitch + dy * 3.0));
  lastX = e.clientX; lastY = e.clientY;
  userPanned = true;
});
window.addEventListener('wheel', e => {
  const zoomSpeed = 100 * (1 / camDist);
  camDist = Math.max(4, Math.min(100, camDist + Math.sign(e.deltaY) * zoomSpeed));
});

// touch controls
canvas.addEventListener('touchstart', e => {
  if (e.touches.length === 1) {
    isDragging = true;
    const t = e.touches[0];
    lastX = t.clientX; lastY = t.clientY;
  } else if (e.touches.length === 2) {
    isPinching = true;
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    lastPinch = Math.hypot(dx, dy);
  }
  e.preventDefault();
}, { passive: false });
window.addEventListener('touchend', e => {
  if (e.touches.length === 0) isDragging = false;
  if (e.touches.length < 2) isPinching = false;
});
window.addEventListener('touchcancel', () => { isDragging = false; isPinching = false; });
window.addEventListener('touchmove', e => {
  if (isPinching && e.touches.length === 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.hypot(dx, dy);
    const delta = dist - lastPinch;
    const zoomSpeed = 20 * (1 / camDist);
    camDist = Math.max(4, Math.min(100, camDist - delta * zoomSpeed));
    lastPinch = dist;
    e.preventDefault();
    return;
  }
  if (isDragging && e.touches.length === 1) {
    const t = e.touches[0];
    const dx = (t.clientX - lastX) / window.innerWidth;
    const dy = (t.clientY - lastY) / window.innerHeight;
    camYaw += dx * 3.0;
    camPitch = Math.max(-1.2, Math.min(1.2, camPitch + dy * 3.0));
    lastX = t.clientX; lastY = t.clientY;
    userPanned = true;
    e.preventDefault();
  }
}, { passive: false });

function getViewProj() {
  const eye = getCameraPos();
  const center = [0, 0, 0], up = [0, 1, 0];
  const view = new Float32Array(16), proj = new Float32Array(16), vp = new Float32Array(16);
  M4.lookAt(view, eye, center, up);
  const fov = 60 * Math.PI / 180;
  M4.perspective(proj, fov, W / H, 0.1, 400);
  M4.multiply(vp, proj, view);
  return vp;
}

function getCameraPos() {
  return [
    camDist * Math.cos(camPitch) * Math.cos(camYaw),
    camDist * Math.sin(camPitch),
    camDist * Math.cos(camPitch) * Math.sin(camYaw),
  ];
}

// --- particle system ------------------------------------------------------
// Particle state is stored in GPU buffers when WebGL2 is available. If WebGL2
// is not supported we keep the state in CPU arrays and upload each frame.
let srcState, dstState = null;
let emitPtr = 0;
let cpuState1, cpuState2, cpuState3;
if (isWebGL2) {
  const stateA = [gl.createBuffer(), gl.createBuffer(), gl.createBuffer()];
  const stateB = [gl.createBuffer(), gl.createBuffer(), gl.createBuffer()];
  for (const buf of [...stateA, ...stateB]) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(MAX_PARTICLES * 4), gl.DYNAMIC_COPY);
  }
  srcState = stateA;
  dstState = stateB;
} else {
  srcState = [gl.createBuffer(), gl.createBuffer(), gl.createBuffer()];
  cpuState1 = new Float32Array(MAX_PARTICLES * 4);
  cpuState2 = new Float32Array(MAX_PARTICLES * 4);
  cpuState3 = new Float32Array(MAX_PARTICLES * 4);
  const arrs = [cpuState1, cpuState2, cpuState3];
  for (let i = 0; i < 3; i++) {
    gl.bindBuffer(gl.ARRAY_BUFFER, srcState[i]);
    gl.bufferData(gl.ARRAY_BUFFER, arrs[i], gl.DYNAMIC_DRAW);
  }
}

function spawnEvent(worldPos) {
  const isoName = isoSelect.value;
  const iso = ISOTOPES[isoName] || ISOTOPES['Ambient (α+β)'];
  if (iso.cosmic) {
    const range = BOUNDS - 2;
    const x = (Math.random() * 2 - 1) * range;
    const z = (Math.random() * 2 - 1) * range;
    const y = BOUNDS + 2;
    const dir = [(Math.random() * 0.1) - 0.05, -1, (Math.random() * 0.1) - 0.05];
    const speed = 30.0;
    const life = 50.0;
    emitParticle(x, y, z, dir[0] * speed, dir[1] * speed, dir[2] * speed, life, 0, 8, 0.5, 0.05);
    return;
  }
  const c = pickComp(iso.mix);
  const d = randDir3();
  const speed = c.speed * (0.85 + 0.3 * Math.random());
  const life = c.life * (0.9 + 0.3 * Math.random());
  const type = c.type === 'alpha' ? 1 : 0;
  emitParticle(worldPos[0], worldPos[1], worldPos[2], d[0] * speed, d[1] * speed, d[2] * speed, life, type, c.size, c.bright, c.qScale);
}

function randDir3() {
  const z = Math.random() * 2 - 1;
  const t = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return [r * Math.cos(t), r * Math.sin(t), z];
}

// Write a particle into the current source buffers at the emit pointer.
function emitParticle(x, y, z, vx, vy, vz, life, type, size, bright, qScale) {
  const idx = emitPtr;
  emitPtr = (emitPtr + 1) % MAX_PARTICLES;
  if (isWebGL2) {
    gl.bindBuffer(gl.ARRAY_BUFFER, srcState[0]);
    gl.bufferSubData(gl.ARRAY_BUFFER, idx * 16, new Float32Array([x, y, z, life]));
    gl.bindBuffer(gl.ARRAY_BUFFER, srcState[1]);
    gl.bufferSubData(gl.ARRAY_BUFFER, idx * 16, new Float32Array([vx, vy, vz, type]));
    gl.bindBuffer(gl.ARRAY_BUFFER, srcState[2]);
    gl.bufferSubData(gl.ARRAY_BUFFER, idx * 16, new Float32Array([size, bright, 1, qScale || 1.0]));
  } else {
    const base = idx * 4;
    cpuState1.set([x, y, z, life], base);
    cpuState2.set([vx, vy, vz, type], base);
    cpuState3.set([size, bright, 1, qScale || 1.0], base);
    gl.bindBuffer(gl.ARRAY_BUFFER, srcState[0]);
    gl.bufferSubData(gl.ARRAY_BUFFER, idx * 16, cpuState1.subarray(base, base + 4));
    gl.bindBuffer(gl.ARRAY_BUFFER, srcState[1]);
    gl.bufferSubData(gl.ARRAY_BUFFER, idx * 16, cpuState2.subarray(base, base + 4));
    gl.bindBuffer(gl.ARRAY_BUFFER, srcState[2]);
    gl.bufferSubData(gl.ARRAY_BUFFER, idx * 16, cpuState3.subarray(base, base + 4));
  }
}

function worldFromScreen(x, y) {
  const yaw = camYaw, pitch = camPitch, dist = camDist;
  const eye = [
    dist * Math.cos(pitch) * Math.cos(yaw),
    dist * Math.sin(pitch),
    dist * Math.cos(pitch) * Math.sin(yaw),
  ];
  const ndcX = (x / window.innerWidth) * 2 - 1;
  const ndcY = 1 - (y / window.innerHeight) * 2;
  const forward = [-eye[0], -eye[1], -eye[2]];
  const fl = Math.hypot(forward[0], forward[1], forward[2]);
  forward[0] /= fl; forward[1] /= fl; forward[2] /= fl;
  let right = [forward[2], 0, -forward[0]];
  let rl = Math.hypot(right[0], right[1], right[2]);
  right = [right[0] / rl, right[1] / rl, right[2] / rl];
  let up = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0]
  ];
  const fov = 60 * Math.PI / 180, aspect = window.innerWidth / window.innerHeight, tanF = Math.tan(fov / 2);
  const rayDir = [
    forward[0] + ndcX * aspect * tanF * right[0] + ndcY * tanF * up[0],
    forward[1] + ndcX * aspect * tanF * right[1] + ndcY * tanF * up[1],
    forward[2] + ndcX * aspect * tanF * right[2] + ndcY * tanF * up[2],
  ];
  const t = -eye[1] / (rayDir[1] || 1e-6);
  return [eye[0] + rayDir[0] * t, 0, eye[2] + rayDir[2] * t];
}

canvas.addEventListener('click', (e) => {
  const p = worldFromScreen(e.clientX, e.clientY);
  spawnEvent(p);
});

// controls
const bSlider = document.getElementById('bRange');
const vSlider = document.getElementById('vRange');
const rSlider = document.getElementById('rRange');
const trailSlider = document.getElementById('trailRange');
const isoSelect = document.getElementById('isoSelect');
const toggleBtn = document.getElementById('toggleBtn');
const clearBtn = document.getElementById('clearBtn');
const densityBtn = document.getElementById('densityBtn');
const settingsBtn = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settingsPanel');

function updateSettingsBtn() {
  if (settingsPanel.classList.contains('open')) {
    const w = settingsPanel.offsetWidth;
    settingsBtn.style.transform = `translateX(${w}px)`;
  } else {
    settingsBtn.style.transform = '';
  }
}

const isoActivities = {};
for (const opt of isoSelect.options) {
  isoActivities[opt.value] = parseFloat(rSlider.value);
}
isoActivities['Cosmic Muons (μ)'] = 5;
isoSelect.addEventListener('change', () => {
  rSlider.value = isoActivities[isoSelect.value] || 0;
});
rSlider.addEventListener('input', () => {
  isoActivities[isoSelect.value] = parseFloat(rSlider.value);
});

let paused = false;
toggleBtn.addEventListener('click', () => { paused = !paused; toggleBtn.textContent = paused ? 'Resume' : 'Pause'; });
clearBtn.addEventListener('click', () => { clearTargets(); });
densityBtn.addEventListener('click', () => { showDensity = !showDensity; densityBtn.textContent = showDensity ? 'Density: On' : 'Density: Off'; if (showDensity) clearDensityTargets(); });
settingsBtn.addEventListener('click', () => { settingsPanel.classList.toggle('open'); updateSettingsBtn(); });
window.addEventListener('resize', updateSettingsBtn);
updateSettingsBtn();
let showDensity = false;

let step;
if (isWebGL2) {
  step = function (dt) {
    const B = parseFloat(bSlider.value);
    const vapor = parseFloat(vSlider.value);
    const activity = parseFloat(rSlider.value);

    const expected = activity * dt;
    let births = Math.floor(expected);
    if (Math.random() < (expected - births)) births++;
    const isoName = isoSelect.value;
    for (let i = 0; i < births; i++) {
      if (isoName === 'Cosmic Muons (μ)') {
        spawnEvent(null);
      } else {
        const margin = 2.0; const range = BOUNDS - margin;
        const pos = [(Math.random() * 2 - 1) * range, (Math.random() * 2 - 1) * range, (Math.random() * 2 - 1) * range];
        spawnEvent(pos);
      }
    }

    const dragBase = 0.3 + vapor * 0.8;
    const jitter = 0.3 + vapor * 1.2;

    gl.useProgram(updateProg);
    const loc1 = gl.getAttribLocation(updateProg, 'a_state1');
    const loc2 = gl.getAttribLocation(updateProg, 'a_state2');
    const loc3 = gl.getAttribLocation(updateProg, 'a_state3');
    gl.bindBuffer(gl.ARRAY_BUFFER, srcState[0]);
    gl.enableVertexAttribArray(loc1);
    gl.vertexAttribPointer(loc1, 4, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, srcState[1]);
    gl.enableVertexAttribArray(loc2);
    gl.vertexAttribPointer(loc2, 4, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, srcState[2]);
    gl.enableVertexAttribArray(loc3);
    gl.vertexAttribPointer(loc3, 4, gl.FLOAT, false, 0, 0);

    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, dstState[0]);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, dstState[1]);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 2, dstState[2]);

    gl.uniform1f(gl.getUniformLocation(updateProg, 'u_dt'), dt);
    gl.uniform1f(gl.getUniformLocation(updateProg, 'u_bounds'), BOUNDS);
    gl.uniform1f(gl.getUniformLocation(updateProg, 'u_dragBase'), dragBase);
    gl.uniform1f(gl.getUniformLocation(updateProg, 'u_jitter'), jitter);
    gl.uniform1f(gl.getUniformLocation(updateProg, 'u_B'), B);

    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, MAX_PARTICLES);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);

    // Unbind transform feedback buffers so they can be used for drawing or updates.
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, null);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 2, null);

    gl.disableVertexAttribArray(loc1);
    gl.disableVertexAttribArray(loc2);
    gl.disableVertexAttribArray(loc3);

    // swap state buffers
    let tmp = srcState; srcState = dstState; dstState = tmp;
  };
} else {
  step = function (dt) {
    const B = parseFloat(bSlider.value);
    const vapor = parseFloat(vSlider.value);
    const activity = parseFloat(rSlider.value);

    const expected = activity * dt;
    let births = Math.floor(expected);
    if (Math.random() < (expected - births)) births++;
    const isoName = isoSelect.value;
    for (let i = 0; i < births; i++) {
      if (isoName === 'Cosmic Muons (μ)') {
        spawnEvent(null);
      } else {
        const margin = 2.0; const range = BOUNDS - margin;
        const pos = [(Math.random() * 2 - 1) * range, (Math.random() * 2 - 1) * range, (Math.random() * 2 - 1) * range];
        spawnEvent(pos);
      }
    }

    const dragBase = 0.3 + vapor * 0.8;
    const jitter = 0.3 + vapor * 1.2;

    function rand(seed) {
      const s = Math.sin(seed) * 43758.5453123;
      return s - Math.floor(s);
    }

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const base = i * 4;
      let x = cpuState1[base], y = cpuState1[base + 1], z = cpuState1[base + 2], life = cpuState1[base + 3];
      let vx = cpuState2[base], vy = cpuState2[base + 1], vz = cpuState2[base + 2], type = cpuState2[base + 3];
      let size = cpuState3[base], bright = cpuState3[base + 1], active = cpuState3[base + 2], qScale = cpuState3[base + 3];
      if (active > 0.5) {
        const qBase = type > 0.5 ? 0.6 : 1.0;
        const q = qBase * qScale;
        const ax = q * (vz * B);
        const az = q * (-vx * B);
        vx += ax * dt;
        vz += az * dt;
        const drag = Math.exp(-dragBase * dt);
        vx *= drag; vy *= drag; vz *= drag;
        const seed = i;
        vx += (rand(seed * 12.9898) * 2 - 1) * jitter * dt;
        vy += (rand(seed * 78.233) * 2 - 1) * jitter * dt * 0.5;
        vz += (rand(seed * 37.719) * 2 - 1) * jitter * dt;
        x += vx * dt; y += vy * dt; z += vz * dt;
        life -= dt;
        active = (life > 0.0 && Math.abs(x) < BOUNDS && Math.abs(y) < BOUNDS && Math.abs(z) < BOUNDS) ? 1.0 : 0.0;
        bright = bright * Math.max(0.25, life * 0.15);
      }
      cpuState1[base] = x; cpuState1[base + 1] = y; cpuState1[base + 2] = z; cpuState1[base + 3] = life;
      cpuState2[base] = vx; cpuState2[base + 1] = vy; cpuState2[base + 2] = vz; cpuState2[base + 3] = type;
      cpuState3[base] = size; cpuState3[base + 1] = bright; cpuState3[base + 2] = active; cpuState3[base + 3] = qScale;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, srcState[0]);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, cpuState1);
    gl.bindBuffer(gl.ARRAY_BUFFER, srcState[1]);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, cpuState2);
    gl.bindBuffer(gl.ARRAY_BUFFER, srcState[2]);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, cpuState3);
  };
}

function renderTo(targetFBO, texPrev, decay) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, targetFBO);
  gl.viewport(0, 0, W, H);

  // 1) decay previous frame (OVERWRITE, blending off)
  gl.disable(gl.BLEND);
  gl.useProgram(decayProg);
  bindQuadAttribs(decayProg);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texPrev);
  gl.uniform1i(gl.getUniformLocation(decayProg, 'u_prev'), 0);
  gl.uniform1f(gl.getUniformLocation(decayProg, 'u_decay'), decay);
  gl.uniform2f(gl.getUniformLocation(decayProg, 'u_texel'), 1 / W, 1 / H);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // 2) draw particles (ADDITIVE)
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.useProgram(pProg);
  bindParticlesAttribs(pProg, srcState);
  gl.uniformMatrix4fv(gl.getUniformLocation(pProg, 'u_viewProj'), false, getViewProj());
  gl.uniform1f(gl.getUniformLocation(pProg, 'u_dpr'), DPR);
  gl.drawArrays(gl.POINTS, 0, MAX_PARTICLES);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function renderDensity(targetFBO, texPrev, decay) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, targetFBO);
  gl.viewport(0, 0, DENS_RES, DENS_RES);

  gl.disable(gl.BLEND);
  gl.useProgram(decayProg);
  bindQuadAttribs(decayProg);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texPrev);
  gl.uniform1i(gl.getUniformLocation(decayProg, 'u_prev'), 0);
  gl.uniform1f(gl.getUniformLocation(decayProg, 'u_decay'), decay);
  gl.uniform2f(gl.getUniformLocation(decayProg, 'u_texel'), 1 / DENS_RES, 1 / DENS_RES);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.useProgram(p2dProg);
  bindParticlesAttribs(p2dProg, srcState);
  gl.uniform1f(gl.getUniformLocation(p2dProg, 'u_bounds'), BOUNDS);
  gl.uniform1f(gl.getUniformLocation(p2dProg, 'u_dpr'), DPR);
  gl.drawArrays(gl.POINTS, 0, MAX_PARTICLES);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function present(tex, t) {
  // draw accumulation to screen, then overlay vapor and glass cube
  gl.disable(gl.DEPTH_TEST);
  // copy to screen
  gl.viewport(0, 0, W, H);
  gl.disable(gl.BLEND);
  gl.useProgram(quadProg);
  bindQuadAttribs(quadProg);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(gl.getUniformLocation(quadProg, 'u_tex'), 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // draw vapor
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(true);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.depthMask(false);
  gl.useProgram(vaporProg);
  bindVaporAttribs(vaporProg);
  gl.uniformMatrix4fv(gl.getUniformLocation(vaporProg, 'u_viewProj'), false, getViewProj());
  gl.uniform1f(gl.getUniformLocation(vaporProg, 'u_time'), t / 1000.0);
  gl.drawArrays(gl.TRIANGLES, 0, VAPOR_SLICES * 6);
  gl.depthMask(true);

  // draw glass cube
  gl.useProgram(glassProg);
  bindGlassAttribs(glassProg);
  const eye = getCameraPos();
  gl.uniformMatrix4fv(gl.getUniformLocation(glassProg, 'u_viewProj'), false, getViewProj());
  gl.uniform3f(gl.getUniformLocation(glassProg, 'u_eye'), eye[0], eye[1], eye[2]);
  gl.depthMask(false);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.FRONT);
  gl.drawArrays(gl.TRIANGLES, 0, 36);
  gl.cullFace(gl.BACK);
  gl.drawArrays(gl.TRIANGLES, 0, 36);
  gl.disable(gl.CULL_FACE);
  gl.depthMask(true);

  // draw edge lines on top
  gl.disable(gl.BLEND);
  gl.useProgram(edgeProg);
  bindEdgeAttribs(edgeProg);
  gl.uniformMatrix4fv(gl.getUniformLocation(edgeProg, 'u_viewProj'), false, getViewProj());
  gl.uniform3f(gl.getUniformLocation(edgeProg, 'u_color'), 0.4, 0.6, 0.7);
  gl.lineWidth(3);
  gl.drawArrays(gl.LINES, 0, 24);
  gl.lineWidth(1);
  gl.enable(gl.BLEND);

  gl.disable(gl.DEPTH_TEST);

  if (showDensity) {
    const size = Math.floor(Math.min(W, H) * 0.3);
    gl.viewport(10, 10, size, size);
    gl.disable(gl.BLEND);
    gl.useProgram(quadProg);
    bindQuadAttribs(quadProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, densTexA);
    gl.uniform1i(gl.getUniformLocation(quadProg, 'u_tex'), 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.viewport(0, 0, W, H);
  }
}

function bindQuadAttribs(prog) {
  const loc = gl.getAttribLocation(prog, 'a_pos');
  gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
}

function bindParticlesAttribs(prog, state) {
  const locPos = gl.getAttribLocation(prog, 'a_pos');
  const locSize = gl.getAttribLocation(prog, 'a_size');
  const locBright = gl.getAttribLocation(prog, 'a_brightness');
  const locType = gl.getAttribLocation(prog, 'a_type');
  const locActive = gl.getAttribLocation(prog, 'a_active');

  gl.bindBuffer(gl.ARRAY_BUFFER, state[0]);
  gl.enableVertexAttribArray(locPos);
  gl.vertexAttribPointer(locPos, 3, gl.FLOAT, false, 16, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, state[1]);
  gl.enableVertexAttribArray(locType);
  gl.vertexAttribPointer(locType, 1, gl.FLOAT, false, 16, 12);

  gl.bindBuffer(gl.ARRAY_BUFFER, state[2]);
  gl.enableVertexAttribArray(locSize);
  gl.vertexAttribPointer(locSize, 1, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(locBright);
  gl.vertexAttribPointer(locBright, 1, gl.FLOAT, false, 16, 4);
  gl.enableVertexAttribArray(locActive);
  gl.vertexAttribPointer(locActive, 1, gl.FLOAT, false, 16, 8);
}

function bindGlassAttribs(prog) {
  const locPos = gl.getAttribLocation(prog, 'a_pos');
  const locNorm = gl.getAttribLocation(prog, 'a_norm');
  gl.bindBuffer(gl.ARRAY_BUFFER, glassVBO);
  gl.enableVertexAttribArray(locPos);
  gl.vertexAttribPointer(locPos, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(locNorm);
  gl.vertexAttribPointer(locNorm, 3, gl.FLOAT, false, 24, 12);
}

function bindVaporAttribs(prog) {
  const locPos = gl.getAttribLocation(prog, 'a_pos');
  gl.bindBuffer(gl.ARRAY_BUFFER, vaporVBO);
  gl.enableVertexAttribArray(locPos);
  gl.vertexAttribPointer(locPos, 3, gl.FLOAT, false, 0, 0);
}

function bindEdgeAttribs(prog) {
  const locPos = gl.getAttribLocation(prog, 'a_pos');
  gl.bindBuffer(gl.ARRAY_BUFFER, edgeVBO);
  gl.enableVertexAttribArray(locPos);
  gl.vertexAttribPointer(locPos, 3, gl.FLOAT, false, 0, 0);
}

// main loop
let lastT = performance.now();
function frame(t) {
  const dt = Math.min(DT_MAX, (t - lastT) / 1000);
  lastT = t;
  if (!userPanned) camYaw += dt * 0.1;
  if (!paused) step(dt);
  const decay = parseFloat(trailSlider.value);
  renderTo(fboA, texB, decay);
  if (showDensity) renderDensity(densFboA, densTexB, decay);
  present(texA, t);
  // swap
  let tmpT = texA; texA = texB; texB = tmpT;
  let tmpF = fboA; fboA = fboB; fboB = tmpF;
  if (showDensity) {
    tmpT = densTexA; densTexA = densTexB; densTexB = tmpT;
    tmpF = densFboA; densFboA = densFboB; densFboB = tmpF;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// initial seeds scattered uniformly
for (let i = 0; i < 48; i++) {
  const margin = 2.0; const range = BOUNDS - margin;
  spawnEvent([(Math.random() * 2 - 1) * range, (Math.random() * 2 - 1) * range, (Math.random() * 2 - 1) * range]);
}

// ensure we start with a clean buffer
clearTargets();
