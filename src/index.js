import { createGL, createProgram, createTexture, createFBO } from './utils/gl';
import quadVS from './shaders/quad.vs';
import decayFS from './shaders/decay.fs';
import copyFS from './shaders/copy.fs';
import particlesVS from './shaders/particles.vs';
import particlesFS from './shaders/particles.fs';
import linesVS from './shaders/lines.vs';
import linesFS from './shaders/lines.fs';


// --- math helpers (column-major, as WebGL expects)
const M4 = {
  perspective(out, fovy, aspect, near, far){
    const f = 1.0 / Math.tan(fovy * 0.5);
    const nf = 1.0 / (near - far);
    out[0]  = f / aspect;
    out[1]  = 0;
    out[2]  = 0;
    out[3]  = 0;
    out[4]  = 0;
    out[5]  = f;
    out[6]  = 0;
    out[7]  = 0;
    out[8]  = 0;
    out[9]  = 0;
    out[10] = (far + near) * nf;
    out[11] = -1;
    out[12] = 0;
    out[13] = 0;
    out[14] = (2 * far * near) * nf;
    out[15] = 0;
    return out;
  },
  lookAt(out, eye, center, up){
    let zx = eye[0] - center[0];
    let zy = eye[1] - center[1];
    let zz = eye[2] - center[2];
    let rl = 1 / Math.hypot(zx, zy, zz);
    zx *= rl; zy *= rl; zz *= rl; // forward (camera Z)

    let xx = up[1]*zz - up[2]*zy;
    let xy = up[2]*zx - up[0]*zz;
    let xz = up[0]*zy - up[1]*zx;
    rl = 1 / Math.hypot(xx, xy, xz);
    xx *= rl; xy *= rl; xz *= rl; // right (camera X)

    let yx = zy*xz - zz*xy;
    let yy = zz*xx - zx*xz;
    let yz = zx*xy - zy*xx;       // up (camera Y)

    out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
    out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
    out[8] = xz; out[9] = yz; out[10]= zz; out[11]= 0;
    out[12] = -(xx*eye[0] + xy*eye[1] + xz*eye[2]);
    out[13] = -(yx*eye[0] + yy*eye[1] + yz*eye[2]);
    out[14] = -(zx*eye[0] + zy*eye[1] + zz*eye[2]);
    out[15] = 1;
    return out;
  },
  multiply(out, a, b){
    // out = a * b (column-major)
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12],a31 = a[13],a32 = a[14], a33 = a[15];

    const b00 = b[0], b01 = b[1], b02 = b[2], b03 = b[3];
    const b10 = b[4], b11 = b[5], b12 = b[6], b13 = b[7];
    const b20 = b[8], b21 = b[9], b22 = b[10], b23 = b[11];
    const b30 = b[12],b31 = b[13],b32 = b[14], b33 = b[15];

    out[0]  = a00*b00 + a10*b01 + a20*b02 + a30*b03;
    out[1]  = a01*b00 + a11*b01 + a21*b02 + a31*b03;
    out[2]  = a02*b00 + a12*b01 + a22*b02 + a32*b03;
    out[3]  = a03*b00 + a13*b01 + a23*b02 + a33*b03;
    out[4]  = a00*b10 + a10*b11 + a20*b12 + a30*b13;
    out[5]  = a01*b10 + a11*b11 + a21*b12 + a31*b13;
    out[6]  = a02*b10 + a12*b11 + a22*b12 + a32*b13;
    out[7]  = a03*b10 + a13*b11 + a23*b12 + a33*b13;
    out[8]  = a00*b20 + a10*b21 + a20*b22 + a30*b23;
    out[9]  = a01*b20 + a11*b21 + a21*b22 + a31*b23;
    out[10] = a02*b20 + a12*b21 + a22*b22 + a32*b23;
    out[11] = a03*b20 + a13*b21 + a23*b22 + a33*b23;
    out[12] = a00*b30 + a10*b31 + a20*b32 + a30*b33;
    out[13] = a01*b30 + a11*b31 + a21*b32 + a31*b33;
    out[14] = a02*b30 + a12*b31 + a22*b32 + a32*b33;
    out[15] = a03*b30 + a13*b31 + a23*b32 + a33*b33;
    return out;
  }
};


// --- simulation parameters
const MAX_PARTICLES = 5000;
const DT_MAX = 1/30;
const BOUNDS = 20;

// track characteristics for each isotope
const ISOTOPES = {
  'Ambient (α+β)': { mix:[
    {type:'alpha', frac:0.30, speed:2.2, life:3.5, size:26, bright:1.05, qScale:1.0},
    {type:'beta',  frac:0.70, speed:7.0, life:7.0, size:10, bright:0.65, qScale:1.0}
  ]},
  'Am-241 (α)': { mix:[ {type:'alpha', frac:1.0, speed:2.1, life:3.8, size:28, bright:1.15, qScale:0.8} ] },
  'Po-210 (α)': { mix:[ {type:'alpha', frac:1.0, speed:2.0, life:3.4, size:28, bright:1.20, qScale:0.8} ] },
  'Rn-222 (α)': { mix:[ {type:'alpha', frac:1.0, speed:2.0, life:3.2, size:26, bright:1.10, qScale:0.85} ] },
  'Sr-90 (β−)': { mix:[ {type:'beta',  frac:1.0, speed:6.5, life:7.5, size:9,  bright:0.60, qScale:1.2} ] },
  'Cs-137 (β−)': { mix:[ {type:'beta',  frac:1.0, speed:7.5, life:8.0, size:10, bright:0.62, qScale:1.2} ] },
  'Co-60 (β−)': { mix:[ {type:'beta',  frac:1.0, speed:5.5, life:6.8, size:9,  bright:0.60, qScale:1.1} ] },
  'Th-232 chain (α+β)': { mix:[
    {type:'alpha', frac:0.60, speed:2.0, life:3.5, size:27, bright:1.10, qScale:0.85},
    {type:'beta',  frac:0.40, speed:6.8, life:7.5, size:10, bright:0.62, qScale:1.15}
  ]},
  'Cosmic Muons (μ)': { cosmic:true }
};

function pickComp(mix){
  const r = Math.random();
  let a = 0;
  for (const c of mix){
    a += c.frac;
    if (r <= a) return c;
  }
  return mix[mix.length-1];
}

const canvas = document.createElement('canvas');
document.getElementById('app').appendChild(canvas);
const gl = createGL(canvas);

// --- create fullscreen quad programs
const quadProg = createProgram(gl, quadVS, copyFS);
const decayProg = createProgram(gl, quadVS, decayFS);

// --- create particle program
const pProg = createProgram(gl, particlesVS, particlesFS);

// --- wireframe cube program
const lineProg = createProgram(gl, linesVS, linesFS);

// --- common geometry buffers
const quadVBO = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([ -1,-1, 1,-1, -1,1, 1,1 ]), gl.STATIC_DRAW);

// particles buffers
const posBuf = gl.createBuffer();
const sizeBuf = gl.createBuffer();
const brightBuf = gl.createBuffer();
const typeBuf = gl.createBuffer();

// cube: 12 edges (24 vertices)
const cubeVBO = gl.createBuffer();
const b = BOUNDS;
const P = [
  [-b,-b,-b],[ b,-b,-b],
  [ b,-b,-b],[ b,-b, b],
  [ b,-b, b],[-b,-b, b],
  [-b,-b, b],[-b,-b,-b], // bottom

  [-b, b,-b],[ b, b,-b],
  [ b, b,-b],[ b, b, b],
  [ b, b, b],[-b, b, b],
  [-b, b, b],[-b, b,-b], // top

  [-b,-b,-b],[-b, b,-b],
  [ b,-b,-b],[ b, b,-b],
  [ b,-b, b],[ b, b, b],
  [-b,-b, b],[-b, b, b]  // verticals
].flat();
gl.bindBuffer(gl.ARRAY_BUFFER, cubeVBO);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(P), gl.STATIC_DRAW);

// accumulation buffers
let texA, texB, fboA, fboB, W=2, H=2;
function createTargets(w,h){
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
function clearTargets(){
  gl.disable(gl.BLEND);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fboA);
  gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fboB);
  gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(2, Math.floor(window.innerWidth * dpr));
  const h = Math.max(2, Math.floor(window.innerHeight * dpr));
  if (w===W && h===H) return;
  W=w; H=h;
  canvas.width = w; canvas.height = h;
  canvas.style.width = '100%'; canvas.style.height = '100%';
  gl.viewport(0,0,w,h);
  createTargets(w,h);
}
window.addEventListener('resize', resize);
resize();

// --- camera
let camYaw = 0.6, camPitch = 0.2, camDist = 14.0;
let isDragging = false, lastX=0, lastY=0;
canvas.addEventListener('mousedown', e=>{ isDragging=true; lastX=e.clientX; lastY=e.clientY; });
window.addEventListener('mouseup', ()=> isDragging=false);
window.addEventListener('mousemove', e=>{
  if(!isDragging) return;
  const dx = (e.clientX-lastX)/window.innerWidth;
  const dy = (e.clientY-lastY)/window.innerHeight;
  camYaw += dx*3.0;
  camPitch = Math.max(-1.2, Math.min(1.2, camPitch + dy*3.0));
  lastX=e.clientX; lastY=e.clientY;
});
window.addEventListener('wheel', e=>{
  camDist = Math.max(4, Math.min(40, camDist + Math.sign(e.deltaY)));
});

function getViewProj() {
  const eye = [
    camDist*Math.cos(camPitch)*Math.cos(camYaw),
    camDist*Math.sin(camPitch),
    camDist*Math.cos(camPitch)*Math.sin(camYaw),
  ];
  const center=[0,0,0], up=[0,1,0];
  const view = new Float32Array(16), proj=new Float32Array(16), vp=new Float32Array(16);
  M4.lookAt(view, eye, center, up);
  const fov = 60*Math.PI/180;
  M4.perspective(proj, fov, W/H, 0.1, 400);
  M4.multiply(vp, proj, view);
  return vp;
}

// --- particle system
// [x,y,z, vx,vy,vz, life, type(0/1), size, bright, active(0/1), qScale]
const particles = new Float32Array(MAX_PARTICLES * 12);
let pCount = 0;

function spawnEvent(worldPos){
  const isoName = isoSelect.value;
  const iso = ISOTOPES[isoName] || ISOTOPES['Ambient (α+β)'];
  if (iso.cosmic){
    const range = BOUNDS - 2;
    const x = (Math.random()*2-1)*range;
    const z = (Math.random()*2-1)*range;
    const y = BOUNDS + 2;
    const dir = [ (Math.random()*0.1)-0.05, -1, (Math.random()*0.1)-0.05 ];
    const speed = 30.0;
    const life = 50.0;
    emitParticle(x, y, z, dir[0]*speed, dir[1]*speed, dir[2]*speed, life, 0, 8, 0.5, 0.05);
    return;
  }
  const c = pickComp(iso.mix);
  const d = randDir3();
  const speed = c.speed*(0.85+0.3*Math.random());
  const life = c.life*(0.9+0.3*Math.random());
  const type = c.type==='alpha'?1:0;
  emitParticle(worldPos[0], worldPos[1], worldPos[2], d[0]*speed, d[1]*speed, d[2]*speed, life, type, c.size, c.bright, c.qScale);
}

function randDir3(){
  const z = Math.random()*2-1;
  const t = Math.random()*Math.PI*2;
  const r = Math.sqrt(Math.max(0,1-z*z));
  return [r*Math.cos(t), r*Math.sin(t), z];
}

function emitParticle(x,y,z,vx,vy,vz,life,type,size,bright,qScale){
  let idx=-1;
  for (let i=0;i<pCount;i++){
    if (particles[i*12+10]===0){ idx=i; break; }
  }
  if (idx<0){
    if (pCount>=MAX_PARTICLES) return;
    idx=pCount++;
  }
  const o=idx*12;
  particles[o+0]=x; particles[o+1]=y; particles[o+2]=z;
  particles[o+3]=vx; particles[o+4]=vy; particles[o+5]=vz;
  particles[o+6]=life; particles[o+7]=type;
  particles[o+8]=size; particles[o+9]=bright;
  particles[o+10]=1; // active
  particles[o+11]=qScale || 1.0;
}

function worldFromScreen(x,y){
  const yaw=camYaw, pitch=camPitch, dist=camDist;
  const eye=[
    dist*Math.cos(pitch)*Math.cos(yaw),
    dist*Math.sin(pitch),
    dist*Math.cos(pitch)*Math.sin(yaw),
  ];
  const ndcX = (x / window.innerWidth) * 2 - 1;
  const ndcY = 1 - (y / window.innerHeight) * 2;
  const forward=[-eye[0], -eye[1], -eye[2]];
  const fl = Math.hypot(forward[0],forward[1],forward[2]);
  forward[0]/=fl; forward[1]/=fl; forward[2]/=fl;
  let right=[ forward[2], 0, -forward[0] ];
  let rl = Math.hypot(right[0],right[1],right[2]);
  right=[right[0]/rl,right[1]/rl,right[2]/rl];
  let up=[
    right[1]*forward[2] - right[2]*forward[1],
    right[2]*forward[0] - right[0]*forward[2],
    right[0]*forward[1] - right[1]*forward[0]
  ];
  const fov = 60*Math.PI/180, aspect=window.innerWidth/window.innerHeight, tanF = Math.tan(fov/2);
  const rayDir=[
    forward[0] + ndcX*aspect*tanF*right[0] + ndcY*tanF*up[0],
    forward[1] + ndcX*aspect*tanF*right[1] + ndcY*tanF*up[1],
    forward[2] + ndcX*aspect*tanF*right[2] + ndcY*tanF*up[2],
  ];
  const t = -eye[1] / (rayDir[1] || 1e-6);
  return [eye[0]+rayDir[0]*t, 0, eye[2]+rayDir[2]*t];
}

canvas.addEventListener('click', (e)=>{
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

const isoActivities = {};
for (const opt of isoSelect.options){
  isoActivities[opt.value] = parseFloat(rSlider.value);
}
isoActivities['Cosmic Muons (μ)'] = 5;
isoSelect.addEventListener('change', ()=>{
  rSlider.value = isoActivities[isoSelect.value] || 0;
});
rSlider.addEventListener('input', ()=>{
  isoActivities[isoSelect.value] = parseFloat(rSlider.value);
});

let paused=false;
toggleBtn.addEventListener('click',()=>{ paused=!paused; toggleBtn.textContent = paused?'Resume':'Pause'; });
clearBtn.addEventListener('click',()=>{ clearTargets(); });

// upload arrays per frame
let posArr = new Float32Array(MAX_PARTICLES*3);
let sizeArr = new Float32Array(MAX_PARTICLES);
let brightArr = new Float32Array(MAX_PARTICLES);
let typeArr = new Float32Array(MAX_PARTICLES);

function step(dt){
  const B = parseFloat(bSlider.value);
  const vapor = parseFloat(vSlider.value);
  const activity = parseFloat(rSlider.value);

  const expected = activity * dt;
  let births = Math.floor(expected);
  if (Math.random() < (expected-births)) births++;
  const isoName = isoSelect.value;
  for (let i=0;i<births;i++){
    if (isoName === 'Cosmic Muons (μ)'){
      spawnEvent(null);
    } else {
      const margin=2.0; const range=BOUNDS - margin;
      const pos=[(Math.random()*2-1)*range, (Math.random()*2-1)*range, (Math.random()*2-1)*range];
      spawnEvent(pos);
    }
  }

  const dragBase = 0.3 + vapor*0.8;
  const jitter = 0.3 + vapor*1.2;
  for (let i=0;i<pCount;i++){
    const o=i*12;
    if (particles[o+10]===0) continue;
    let x=particles[o+0], y=particles[o+1], z=particles[o+2];
    let vx=particles[o+3], vy=particles[o+4], vz=particles[o+5];
    let life=particles[o+6];
    const type=particles[o+7];
    const qScale = particles[o+11] || 1.0;
    const qBase = (type? 0.6 : 1.0);
    const q = qBase * qScale;
    const Bvec = [0, B, 0];
    const ax = q * (vy*Bvec[2] - vz*Bvec[1]);
    const ay = q * (vz*Bvec[0] - vx*Bvec[2]);
    const az = q * (vx*Bvec[1] - vy*Bvec[0]);
    vx += ax*dt; vy += ay*dt; vz += az*dt;
    const drag = Math.exp(-dragBase*dt);
    vx *= drag; vy *= drag; vz *= drag;
    vx += (Math.random()*2-1) * jitter * dt;
    vy += (Math.random()*2-1) * jitter * dt * 0.5;
    vz += (Math.random()*2-1) * jitter * dt;
    x += vx*dt; y += vy*dt; z += vz*dt;
    life -= dt;
    const active = (life>0 && Math.abs(x)<BOUNDS && Math.abs(y)<BOUNDS && Math.abs(z)<BOUNDS) ? 1:0;
    particles[o+0]=x; particles[o+1]=y; particles[o+2]=z;
    particles[o+3]=vx; particles[o+4]=vy; particles[o+5]=vz;
    particles[o+6]=life; particles[o+10]=active;
    const baseBright = particles[o+9];
    particles[o+9] = baseBright * (0.92 + vapor*0.25) * Math.max(0.25, life*0.15);
    particles[o+8] = (type? 24:9) * (0.9 + vapor*0.8);
  }
}

function renderTo(targetFBO, texPrev, decay) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, targetFBO);
  gl.viewport(0,0,W,H);

  // 1) decay previous frame (OVERWRITE, blending off)
  gl.disable(gl.BLEND);
  gl.useProgram(decayProg);
  bindQuadAttribs(decayProg);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texPrev);
  gl.uniform1i(gl.getUniformLocation(decayProg, 'u_prev'), 0);
  gl.uniform1f(gl.getUniformLocation(decayProg, 'u_decay'), decay);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // 2) draw particles (ADDITIVE)
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.useProgram(pProg);
  bindParticlesAttribs();
  gl.uniformMatrix4fv(gl.getUniformLocation(pProg, 'u_viewProj'), false, getViewProj());
  const n = fillGPUArrays();
  gl.drawArrays(gl.POINTS, 0, n);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function present(tex){
  // draw accumulation to screen, then permanent cube overlay
  gl.disable(gl.DEPTH_TEST);
  // copy to screen
  gl.viewport(0,0,W,H);
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
}

function bindQuadAttribs(prog){
  const loc = gl.getAttribLocation(prog, 'a_pos');
  gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
}

function bindParticlesAttribs(){
  const locPos = gl.getAttribLocation(pProg, 'a_pos');
  const locSize = gl.getAttribLocation(pProg, 'a_size');
  const locBright = gl.getAttribLocation(pProg, 'a_brightness');
  const locType = gl.getAttribLocation(pProg, 'a_type');
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.enableVertexAttribArray(locPos);
  gl.vertexAttribPointer(locPos, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf);
  gl.enableVertexAttribArray(locSize);
  gl.vertexAttribPointer(locSize, 1, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, brightBuf);
  gl.enableVertexAttribArray(locBright);
  gl.vertexAttribPointer(locBright, 1, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, typeBuf);
  gl.enableVertexAttribArray(locType);
  gl.vertexAttribPointer(locType, 1, gl.FLOAT, false, 0, 0);
}

function fillGPUArrays(){
  let n=0;
  for (let i=0;i<pCount;i++){
    const o=i*12;
    if (particles[o+10]===0) continue;
    posArr[n*3+0]=particles[o+0];
    posArr[n*3+1]=particles[o+1];
    posArr[n*3+2]=particles[o+2];
    sizeArr[n]=particles[o+8];
    brightArr[n]=particles[o+9];
    typeArr[n]=particles[o+7];
    n++;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, posArr.subarray(0, n*3), gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf);
  gl.bufferData(gl.ARRAY_BUFFER, sizeArr.subarray(0, n), gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, brightBuf);
  gl.bufferData(gl.ARRAY_BUFFER, brightArr.subarray(0, n), gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, typeBuf);
  gl.bufferData(gl.ARRAY_BUFFER, typeArr.subarray(0, n), gl.DYNAMIC_DRAW);
  return n;
}

// main loop
let lastT = performance.now();
function frame(t){
  const dt = Math.min(DT_MAX, (t-lastT)/1000);
  lastT = t;
  if (!paused) step(dt);
  const decay = parseFloat(trailSlider.value);
  renderTo(fboA, texB, decay);
  present(texA);
  // swap
  let tmpT=texA; texA=texB; texB=tmpT;
  let tmpF=fboA; fboA=fboB; fboB=tmpF;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// initial seeds scattered uniformly
for (let i=0;i<48;i++) {
  const margin=2.0; const range=BOUNDS - margin;
  spawnEvent([(Math.random()*2-1)*range, (Math.random()*2-1)*range, (Math.random()*2-1)*range]);
}

// ensure we start with a clean buffer
clearTargets();
