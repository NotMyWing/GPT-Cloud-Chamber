import { createGL, createProgram, createTexture, createFBO } from './utils/gl';
import quadVS from './shaders/quad.vs';
import decayFS from './shaders/decay.fs';
import copyFS from './shaders/copy.fs';
import particlesVS from './shaders/particles.vs';
import particlesFS from './shaders/particles.fs';
import particles2dVS from './shaders/particles2d.vs';
import linesVS from './shaders/lines.vs';
import linesFS from './shaders/lines.fs';
import updateVS from './shaders/update.vs';
import updateFS from './shaders/update.fs';
import { M4 } from './utils/m4';


// --- simulation parameters
// With GPU transform feedback we can support tens of thousands of particles
// without touching them on the CPU each frame.
const MAX_PARTICLES = 50000;
const DT_MAX = 1 / 30;
const BOUNDS = 20;
const DENS_RES = 256;

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

// --- create fullscreen quad programs
const quadProg = createProgram(gl, quadVS, copyFS);
const decayProg = createProgram(gl, quadVS, decayFS);

// --- create particle program
const pProg = createProgram(gl, particlesVS, particlesFS);
const p2dProg = createProgram(gl, particles2dVS, particlesFS);

// --- wireframe cube program
const lineProg = createProgram(gl, linesVS, linesFS);
// --- particle update program (transform feedback)
const updateProg = createProgram(gl, updateVS, updateFS, {}, ['v_state1', 'v_state2', 'v_state3']);

// --- common geometry buffers
const quadVBO = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

// cube: 12 edges (24 vertices)
const cubeVBO = gl.createBuffer();
const b = BOUNDS;
const P = [
  [-b, -b, -b], [b, -b, -b],
  [b, -b, -b], [b, -b, b],
  [b, -b, b], [-b, -b, b],
  [-b, -b, b], [-b, -b, -b], // bottom

  [-b, b, -b], [b, b, -b],
  [b, b, -b], [b, b, b],
  [b, b, b], [-b, b, b],
  [-b, b, b], [-b, b, -b], // top

  [-b, -b, -b], [-b, b, -b],
  [b, -b, -b], [b, b, -b],
  [b, -b, b], [b, b, b],
  [-b, -b, b], [-b, b, b]  // verticals
].flat();
gl.bindBuffer(gl.ARRAY_BUFFER, cubeVBO);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(P), gl.STATIC_DRAW);

// accumulation buffers
let texA, texB, fboA, fboB, W = 2, H = 2;
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
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(2, Math.floor(window.innerWidth * dpr));
  const h = Math.max(2, Math.floor(window.innerHeight * dpr));
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
let camYaw = 0.6, camPitch = 0.2, camDist = 14.0;
let isDragging = false, lastX = 0, lastY = 0;
canvas.addEventListener('mousedown', e => { isDragging = true; lastX = e.clientX; lastY = e.clientY; });
window.addEventListener('mouseup', () => isDragging = false);
window.addEventListener('mousemove', e => {
  if (!isDragging) return;
  const dx = (e.clientX - lastX) / window.innerWidth;
  const dy = (e.clientY - lastY) / window.innerHeight;
  camYaw += dx * 3.0;
  camPitch = Math.max(-1.2, Math.min(1.2, camPitch + dy * 3.0));
  lastX = e.clientX; lastY = e.clientY;
});
window.addEventListener('wheel', e => {
  camDist = Math.max(4, Math.min(40, camDist + Math.sign(e.deltaY)));
});

function getViewProj() {
  const eye = [
    camDist * Math.cos(camPitch) * Math.cos(camYaw),
    camDist * Math.sin(camPitch),
    camDist * Math.cos(camPitch) * Math.sin(camYaw),
  ];
  const center = [0, 0, 0], up = [0, 1, 0];
  const view = new Float32Array(16), proj = new Float32Array(16), vp = new Float32Array(16);
  M4.lookAt(view, eye, center, up);
  const fov = 60 * Math.PI / 180;
  M4.perspective(proj, fov, W / H, 0.1, 400);
  M4.multiply(vp, proj, view);
  return vp;
}

// --- particle system ------------------------------------------------------
// Particle state is kept entirely on the GPU using transform feedback. Each
// particle is represented by three vec4 buffers (position/life, velocity/type
// and size/brightness/active/qScale) that are ping‑ponged every frame.
const stateA = [gl.createBuffer(), gl.createBuffer(), gl.createBuffer()];
const stateB = [gl.createBuffer(), gl.createBuffer(), gl.createBuffer()];
for (const buf of [...stateA, ...stateB]) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(MAX_PARTICLES * 4), gl.DYNAMIC_COPY);
}
let srcState = stateA;
let dstState = stateB;
let emitPtr = 0;

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
  gl.bindBuffer(gl.ARRAY_BUFFER, srcState[0]);
  gl.bufferSubData(gl.ARRAY_BUFFER, idx * 16, new Float32Array([x, y, z, life]));
  gl.bindBuffer(gl.ARRAY_BUFFER, srcState[1]);
  gl.bufferSubData(gl.ARRAY_BUFFER, idx * 16, new Float32Array([vx, vy, vz, type]));
  gl.bindBuffer(gl.ARRAY_BUFFER, srcState[2]);
  gl.bufferSubData(gl.ARRAY_BUFFER, idx * 16, new Float32Array([size, bright, 1, qScale || 1.0]));
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
let showDensity = false;

function step(dt) {
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
  gl.drawArrays(gl.POINTS, 0, MAX_PARTICLES);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function present(tex) {
  // draw accumulation to screen, then permanent cube overlay
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

  // overlay cube
  gl.useProgram(lineProg);
  // permanent bounds cube overlay (independent of accumulation)
  const loc = gl.getAttribLocation(lineProg, 'a_pos');
  gl.bindBuffer(gl.ARRAY_BUFFER, cubeVBO);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
  gl.uniformMatrix4fv(gl.getUniformLocation(lineProg, 'u_viewProj'), false, getViewProj());
  gl.uniform3f(gl.getUniformLocation(lineProg, 'u_color'), 0.9, 0.95, 1.0);
  gl.drawArrays(gl.LINES, 0, 24);

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

// main loop
let lastT = performance.now();
function frame(t) {
  const dt = Math.min(DT_MAX, (t - lastT) / 1000);
  lastT = t;
  if (!paused) step(dt);
  const decay = parseFloat(trailSlider.value);
  renderTo(fboA, texB, decay);
  if (showDensity) renderDensity(densFboA, densTexB, decay);
  present(texA);
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
