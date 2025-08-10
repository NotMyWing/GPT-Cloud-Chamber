
(function(){
  'use strict';
  const quadVS = `attribute vec2 a_pos;
varying vec2 v_uv;
void main(){ v_uv = a_pos*0.5 + 0.5; gl_Position = vec4(a_pos,0.0,1.0); }
`;
  const decayFS = `precision highp float;
varying vec2 v_uv;
uniform sampler2D u_prev;
uniform float u_decay;
void main(){
  vec4 col = texture2D(u_prev, v_uv);
  gl_FragColor = vec4(col.rgb * u_decay, 1.0);
}
`;
  const copyFS  = `precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
void main(){ gl_FragColor = texture2D(u_tex, v_uv); }
`;
  const particlesVS = `precision highp float;
attribute vec3 a_pos;
attribute float a_size;
attribute float a_brightness;
attribute float a_type; // 0=beta,1=alpha
uniform mat4 u_viewProj;
varying float v_bright;
varying float v_type;
void main(){
  v_bright = a_brightness;
  v_type = a_type;
  vec4 clip = u_viewProj * vec4(a_pos, 1.0);
  gl_Position = clip;
  float size = a_size / max(0.1, clip.w);
  gl_PointSize = size;
}
`;
  const particlesFS = `precision highp float;
varying float v_bright;
varying float v_type;
void main(){
  vec2 p = gl_PointCoord*2.0 - 1.0;
  float r = length(p);
  float disk = smoothstep(1.0, 0.6, r);
  float core = mix(0.9, 1.3, v_type);
  float glow = mix(0.6, 1.0, v_type);
  vec3 col = vec3(1.0) * (v_bright*core);
  float alpha = disk * glow;
  gl_FragColor = vec4(col, alpha);
}
`;
  const linesVS = `attribute vec3 a_pos;
uniform mat4 u_viewProj;
void main(){ gl_Position = u_viewProj * vec4(a_pos, 1.0); }
`;
  const linesFS = `precision highp float;
uniform vec3 u_color;
void main(){ gl_FragColor = vec4(u_color, 1.0); }
`;

  function createGL(canvas){ const gl = canvas.getContext('webgl', {alpha:false, antialias:true}); if(!gl) throw new Error('WebGL not supported'); return gl; }
  function createShader(gl, type, src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { throw new Error(gl.getShaderInfoLog(s)||'shader compile failed'); } return s; }
  function createProgram(gl, vsSrc, fsSrc){ const vs=createShader(gl, gl.VERTEX_SHADER, vsSrc); const fs=createShader(gl, gl.FRAGMENT_SHADER, fsSrc); const p=gl.createProgram(); gl.attachShader(p,vs); gl.attachShader(p,fs); gl.linkProgram(p); if(!gl.getProgramParameter(p, gl.LINK_STATUS)) { throw new Error(gl.getProgramInfoLog(p)||'program link failed'); } return p; }
  function createTexture(gl,w,h){ const t=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null); gl.bindTexture(gl.TEXTURE_2D,null); return t; }
  function createFBO(gl, tex){ const fb=gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0); if (gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) throw new Error('FBO incomplete'); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return fb; }

  const M4 = {
    perspective(out,fovy,aspect,near,far){ const f=1/Math.tan(fovy/2), nf=1/(near-far);
      out[0]=f/aspect; out[1]=0; out[2]=0; out[3]=0; out[4]=0; out[5]=f; out[6]=0; out[7]=0;
      out[8]=0; out[9]=0; out[10]=(far+near)*nf; out[11]=-1; out[12]=0; out[13]=0; out[14]=2*far*near*nf; out[15]=0; return out; },
    lookAt(out,eye,center,up){ let x0,x1,x2,y0,y1,y2,z0,z1,z2,len;
      z0=eye[0]-center[0]; z1=eye[1]-center[1]; z2=eye[2]-center[2]; len=Math.hypot(z0,z1,z2); z0/=len; z1/=len; z2/=len;
      x0=up[1]*z2-up[2]*z1; x1=up[2]*z0-up[0]*z2; x2=up[0]*z1-up[1]*z0; len=Math.hypot(x0,x1,x2); x0/=len; x1/=len; x2/=len;
      y0=z1*x2 - z2*x1; y1=z2*x0 - z0*x2; y2=z0*x1 - z1*x0;
      out[0]=x0; out[1]=y0; out[2]=z0; out[3]=0;
      out[4]=x1; out[5]=y1; out[6]=z1; out[7]=0;
      out[8]=x2; out[9]=y2; out[10]=z2; out[11]=0;
      out[12]=-(x0*eye[0]+x1*eye[1]+x2*eye[2]); out[13]=-(y0*eye[0]+y1*eye[1]+y2*eye[2]); out[14]=-(z0*eye[0]+z1*eye[1]+z2*eye[2]); out[15]=1; return out; },
    multiply(out,a,b){ const o=new Float32Array(16); for(let r=0;r<4;r++) for(let c=0;c<4;c++) o[c+r*4]=a[r*4+0]*b[c+0]+a[r*4+1]*b[c+4]+a[r*4+2]*b[c+8]+a[r*4+3]*b[c+12]; out.set(o); return out; }
  };

  const MAX_PARTICLES=8000, ION_RATE_BASE=200, DT_MAX=1/30, BOUNDS=20;

  const ISOTOPES = {
    "Ambient (α+β)": { mix:[
      {type:'alpha', frac:0.30, speed:2.2, life:3.5, size:26, bright:1.05, qScale:1.0},
      {type:'beta',  frac:0.70, speed:7.0, life:7.0, size:10, bright:0.65, qScale:1.0}
    ]},
    "Am-241 (α)": { mix:[ {type:'alpha', frac:1.0, speed:2.1, life:3.8, size:28, bright:1.15, qScale:0.8} ] },
    "Po-210 (α)": { mix:[ {type:'alpha', frac:1.0, speed:2.0, life:3.4, size:28, bright:1.20, qScale:0.8} ] },
    "Rn-222 (α)": { mix:[ {type:'alpha', frac:1.0, speed:2.0, life:3.2, size:26, bright:1.10, qScale:0.85} ] },
    "Sr-90 (β−)": { mix:[ {type:'beta',  frac:1.0, speed:6.5, life:7.5, size:9,  bright:0.60, qScale:1.2} ] },
    "Cs-137 (β−)": { mix:[ {type:'beta',  frac:1.0, speed:7.5, life:8.0, size:10, bright:0.62, qScale:1.2} ] },
    "Co-60 (β−)": { mix:[ {type:'beta',  frac:1.0, speed:5.5, life:6.8, size:9,  bright:0.60, qScale:1.1} ] },
    "Th-232 chain (α+β)": { mix:[
      {type:'alpha', frac:0.60, speed:2.0, life:3.5, size:27, bright:1.10, qScale:0.85},
      {type:'beta',  frac:0.40, speed:6.8, life:7.5, size:10, bright:0.62, qScale:1.15}
    ]}
  };

  const app=document.getElementById('app'); const canvas=document.createElement('canvas'); app.appendChild(canvas);
  const gl=createGL(canvas);

  const quadProg=createProgram(gl, quadVS, copyFS);
  const decayProg=createProgram(gl, quadVS, decayFS);
  const pProg=createProgram(gl, particlesVS, particlesFS);
  const lineProg=createProgram(gl, linesVS, linesFS);

  const quadVBO=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);

  const posBuf=gl.createBuffer(), sizeBuf=gl.createBuffer(), brightBuf=gl.createBuffer(), typeBuf=gl.createBuffer();

  const cubeVBO=gl.createBuffer(); const b=BOUNDS;
  const C=[
    -b,-b,-b,  b,-b,-b,  b,-b,-b,  b,-b, b,  b,-b, b, -b,-b, b, -b,-b, b, -b,-b,-b,
    -b, b,-b,  b, b,-b,  b, b,-b,  b, b, b,  b, b, b, -b, b, b, -b, b, b, -b, b,-b,
    -b,-b,-b, -b, b,-b,  b,-b,-b,  b, b,-b,  b,-b, b,  b, b, b, -b,-b, b, -b, b, b
  ];
  gl.bindBuffer(gl.ARRAY_BUFFER, cubeVBO);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(C), gl.STATIC_DRAW);

  let texA,texB,fboA,fboB,W=2,H=2;
  function clearTargets(){ gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fboA); gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fboB); gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  function createTargets(w,h){ if(texA) gl.deleteTexture(texA); if(texB) gl.deleteTexture(texB);
    if(fboA) gl.deleteFramebuffer(fboA); if(fboB) gl.deleteFramebuffer(fboB);
    texA=createTexture(gl,w,h); texB=createTexture(gl,w,h);
    fboA=createFBO(gl, texA); fboB=createFBO(gl, texB); clearTargets(); }
  function resize(){ const dpr=Math.min(2, window.devicePixelRatio||1);
    const w=Math.max(2, Math.floor(window.innerWidth*dpr));
    const h=Math.max(2, Math.floor(window.innerHeight*dpr));
    if(w===W&&h===H) return; W=w; H=h; canvas.width=w; canvas.height=h; canvas.style.width='100%'; canvas.style.height='100%';
    gl.viewport(0,0,w,h); createTargets(w,h); }
  window.addEventListener('resize', resize); resize();

  let camYaw=0.5, camPitch=0.25, camDist=32.0, dragging=false, lx=0,ly=0;
  canvas.addEventListener('mousedown', e=>{ dragging=true; lx=e.clientX; ly=e.clientY; });
  window.addEventListener('mouseup', ()=> dragging=false);
  window.addEventListener('mousemove', e=>{ if(!dragging) return; camYaw += (e.clientX-lx)/window.innerWidth*3; camPitch = Math.max(-1.2, Math.min(1.2, camPitch + (e.clientY-ly)/window.innerHeight*3)); lx=e.clientX; ly=e.clientY; });
  window.addEventListener('wheel', e=>{ camDist = Math.max(10, Math.min(100, camDist + Math.sign(e.deltaY))); });
  function getViewProj(){ const eye=[ camDist*Math.cos(camPitch)*Math.cos(camYaw), camDist*Math.sin(camPitch), camDist*Math.cos(camPitch)*Math.sin(camYaw) ]; const center=[0,0,0], up=[0,1,0]; const view=new Float32Array(16), proj=new Float32Array(16), vp=new Float32Array(16); M4.lookAt(view, eye, center, up); const fov=60*Math.PI/180; M4.perspective(proj, fov, W/H, 0.1, 400); M4.multiply(vp, proj, view); return vp; }

  // particles: [x,y,z, vx,vy,vz, life, type(0=β,1=α), size, bright, active, qScale]
  const particles=new Float32Array(MAX_PARTICLES*12); let pCount=0;
  function randDir3(){ const z=Math.random()*2-1; const t=Math.random()*Math.PI*2; const r=Math.sqrt(Math.max(0,1-z*z)); return [r*Math.cos(t), r*Math.sin(t), z]; }
  function emitParticle(x,y,z,vx,vy,vz,life,type,size,bright,qScale){ let idx=-1; for(let i=0;i<pCount;i++){ if(particles[i*12+10]===0){ idx=i; break; } } if(idx<0){ if(pCount>=MAX_PARTICLES) return; idx=pCount++; } const o=idx*12; particles[o+0]=x; particles[o+1]=y; particles[o+2]=z; particles[o+3]=vx; particles[o+4]=vy; particles[o+5]=vz; particles[o+6]=life; particles[o+7]=type; particles[o+8]=size; particles[o+9]=bright; particles[o+10]=1; particles[o+11]=qScale||1.0; }
  function pickComp(mix){ const r=Math.random(); let a=0; for(const c of mix){ a+=c.frac; if(r<=a) return c; } return mix[mix.length-1]; }
  function spawnEvent(pos){ const iso = ISOTOPES[ document.getElementById('isoSelect').value ] || ISOTOPES['Ambient (α+β)']; const c = pickComp(iso.mix); const d=randDir3(); const speed=c.speed*(0.85+0.3*Math.random()); const life=c.life*(0.9+0.3*Math.random()); const type=c.type==='alpha'?1:0; emitParticle(pos[0],pos[1],pos[2], d[0]*speed, d[1]*speed, d[2]*speed, life, type, c.size, c.bright, c.qScale); }

  function worldFromScreen(x,y){ const yaw=camYaw,pitch=camPitch,dist=camDist;
    const eye=[ dist*Math.cos(pitch)*Math.cos(yaw), dist*Math.sin(pitch), dist*Math.cos(pitch)*Math.sin(yaw) ];
    const f=[-eye[0],-eye[1],-eye[2]]; const fl=Math.hypot(f[0],f[1],f[2]); f[0]/=fl; f[1]/=fl; f[2]/=fl;
    let r=[ f[2],0,-f[0] ]; let rl=Math.hypot(r[0],r[1],r[2]); r=[r[0]/rl,r[1]/rl,r[2]/rl];
    let u=[ r[1]*f[2]-r[2]*f[1], r[2]*f[0]-r[0]*f[2], r[0]*f[1]-r[1]*f[0] ];
    const fov=60*Math.PI/180, aspect=window.innerWidth/window.innerHeight, tanF=Math.tan(fov/2);
    const ndcX=(x/window.innerWidth)*2-1, ndcY=1-(y/window.innerHeight)*2;
    const ray=[ f[0]+ndcX*aspect*tanF*r[0]+ndcY*tanF*u[0], f[1]+ndcX*aspect*tanF*r[1]+ndcY*tanF*u[1], f[2]+ndcX*aspect*tanF*r[2]+ndcY*tanF*u[2] ];
    const t=-eye[1]/(ray[1]||1e-6); return [ eye[0]+ray[0]*t, 0, eye[2]+ray[2]*t ];
  }
  canvas.addEventListener('click', e=>{ spawnEvent(worldFromScreen(e.clientX,e.clientY)); });

  const bSlider=document.getElementById('bRange'), vSlider=document.getElementById('vRange'), rSlider=document.getElementById('rRange'), trailSlider=document.getElementById('trailRange'), toggleBtn=document.getElementById('toggleBtn'), clearBtn=document.getElementById('clearBtn');
  let paused=false; toggleBtn.addEventListener('click',()=>{ paused=!paused; toggleBtn.textContent=paused?'Resume':'Pause'; }); clearBtn.addEventListener('click', clearTargets);

  const posArr=new Float32Array(MAX_PARTICLES*3), sizeArr=new Float32Array(MAX_PARTICLES), brightArr=new Float32Array(MAX_PARTICLES), typeArr=new Float32Array(MAX_PARTICLES);

  function fillGPU(){ let n=0; for(let i=0;i<pCount;i++){ const o=i*12; if(particles[o+10]===0) continue; posArr[n*3+0]=particles[o+0]; posArr[n*3+1]=particles[o+1]; posArr[n*3+2]=particles[o+2]; sizeArr[n]=particles[o+8]; brightArr[n]=particles[o+9]; typeArr[n]=particles[o+7]; n++; } gl.bindBuffer(gl.ARRAY_BUFFER, posBuf); gl.bufferData(gl.ARRAY_BUFFER, posArr.subarray(0,n*3), gl.DYNAMIC_DRAW); gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf); gl.bufferData(gl.ARRAY_BUFFER, sizeArr.subarray(0,n), gl.DYNAMIC_DRAW); gl.bindBuffer(gl.ARRAY_BUFFER, brightBuf); gl.bufferData(gl.ARRAY_BUFFER, brightArr.subarray(0,n), gl.DYNAMIC_DRAW); gl.bindBuffer(gl.ARRAY_BUFFER, typeBuf); gl.bufferData(gl.ARRAY_BUFFER, typeArr.subarray(0,n), gl.DYNAMIC_DRAW); return n; }

  function step(dt){ const B=parseFloat(bSlider.value), vapor=parseFloat(vSlider.value), ionRate=parseFloat(rSlider.value);
    const expected=ION_RATE_BASE*ionRate*dt; let births=Math.floor(expected); if(Math.random()<(expected-births)) births++;
    for(let i=0;i<births;i++){ const range=BOUNDS-2; const pos=[(Math.random()*2-1)*range,(Math.random()*2-1)*range,(Math.random()*2-1)*range]; spawnEvent(pos); }
    const dragBase=0.3+vapor*0.8, jitter=0.3+vapor*1.2;
    for(let i=0;i<pCount;i++){ const o=i*12; if(particles[o+10]===0) continue;
      let x=particles[o+0], y=particles[o+1], z=particles[o+2], vx=particles[o+3], vy=particles[o+4], vz=particles[o+5], life=particles[o+6], type=particles[o+7], qScale=particles[o+11]||1.0;
      const qBase=(type?0.6:1.0), q=qBase*qScale;
      const ax = -q * vz * B;
      const ay = 0.0;
      const az =  q * vx * B;
      vx+=ax*dt; vy+=ay*dt; vz+=az*dt;
      const drag=Math.exp(-dragBase*dt); vx*=drag; vy*=drag; vz*=drag;
      vx+=(Math.random()*2-1)*jitter*dt; vy+=(Math.random()*2-1)*jitter*dt*0.5; vz+=(Math.random()*2-1)*jitter*dt;
      x+=vx*dt; y+=vy*dt; z+=vz*dt; life-=dt;
      const active=(life>0 && Math.abs(x)<BOUNDS && Math.abs(y)<BOUNDS && Math.abs(z)<BOUNDS)?1:0;
      particles[o+0]=x; particles[o+1]=y; particles[o+2]=z; particles[o+3]=vx; particles[o+4]=vy; particles[o+5]=vz; particles[o+6]=life; particles[o+10]=active;
      const baseBright=particles[o+9]; particles[o+9]=baseBright*(0.92+vapor*0.25)*Math.max(0.25, life*0.15);
      particles[o+8]=(type?26:10)*(0.9+vapor*0.8);
    }
  }

  function bindQuad(prog){ const loc=gl.getAttribLocation(prog,'a_pos'); gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0); }
  function bindParticles(){ const lp=gl.getAttribLocation(pProg,'a_pos'), ls=gl.getAttribLocation(pProg,'a_size'), lb=gl.getAttribLocation(pProg,'a_brightness'), lt=gl.getAttribLocation(pProg,'a_type'); gl.bindBuffer(gl.ARRAY_BUFFER, posBuf); gl.enableVertexAttribArray(lp); gl.vertexAttribPointer(lp,3,gl.FLOAT,false,0,0); gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf); gl.enableVertexAttribArray(ls); gl.vertexAttribPointer(ls,1,gl.FLOAT,false,0,0); gl.bindBuffer(gl.ARRAY_BUFFER, brightBuf); gl.enableVertexAttribArray(lb); gl.vertexAttribPointer(lb,1,gl.FLOAT,false,0,0); gl.bindBuffer(gl.ARRAY_BUFFER, typeBuf); gl.enableVertexAttribArray(lt); gl.vertexAttribPointer(lt,1,gl.FLOAT,false,0,0); }

  function renderTo(fbo, texPrev, decay){ gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0,0,W,H);
    gl.disable(gl.BLEND); gl.useProgram(decayProg); bindQuad(decayProg); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texPrev); gl.uniform1i(gl.getUniformLocation(decayProg,'u_prev'),0); gl.uniform1f(gl.getUniformLocation(decayProg,'u_decay'),decay); gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.useProgram(pProg); bindParticles(); gl.uniformMatrix4fv(gl.getUniformLocation(pProg,'u_viewProj'), false, getViewProj()); const n=fillGPU(); gl.drawArrays(gl.POINTS,0,n);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function present(tex){ gl.viewport(0,0,W,H); gl.disable(gl.BLEND); gl.useProgram(quadProg); bindQuad(quadProg); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(gl.getUniformLocation(quadProg,'u_tex'),0); gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.disable(gl.DEPTH_TEST); gl.useProgram(lineProg); const loc=gl.getAttribLocation(lineProg,'a_pos'); gl.bindBuffer(gl.ARRAY_BUFFER, cubeVBO); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,3,gl.FLOAT,false,0,0); gl.uniformMatrix4fv(gl.getUniformLocation(lineProg,'u_viewProj'), false, getViewProj()); gl.uniform3f(gl.getUniformLocation(lineProg,'u_color'), 0.95, 0.95, 1.0); gl.drawArrays(gl.LINES,0,24);
  }

  let lastT=performance.now();
  function frame(t){ const dt=Math.min(DT_MAX, (t-lastT)/1000); lastT=t; if(!paused) step(dt); const decay=parseFloat(trailSlider.value); renderTo(fboA, texB, decay); present(texA); let tt=texA; texA=texB; texB=tt; let ff=fboA; fboA=fboB; fboB=ff; requestAnimationFrame(frame); }

  createTargets(Math.max(2, canvas.width||2), Math.max(2, canvas.height||2));
  for(let i=0;i<64;i++){ const range=BOUNDS-2; spawnEvent([(Math.random()*2-1)*range,(Math.random()*2-1)*range,(Math.random()*2-1)*range]); }
  const toggleBtn=document.getElementById('toggleBtn'), clearBtn=document.getElementById('clearBtn'); let paused=false; toggleBtn.addEventListener('click',()=>{ paused=!paused; toggleBtn.textContent=paused?'Resume':'Pause'; }); clearBtn.addEventListener('click', clearTargets);
  requestAnimationFrame(frame);
  console.log('Cloud chamber v6 with isotopes ready.');
})();
