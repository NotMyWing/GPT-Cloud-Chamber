precision highp float;
varying vec3 v_pos;
uniform float u_time;

float hash(vec3 p){
  return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453123);
}

float noise(vec3 p){
  vec3 i = floor(p);
  vec3 f = fract(p);
  float n000 = hash(i);
  float n100 = hash(i + vec3(1.0,0.0,0.0));
  float n010 = hash(i + vec3(0.0,1.0,0.0));
  float n110 = hash(i + vec3(1.0,1.0,0.0));
  float n001 = hash(i + vec3(0.0,0.0,1.0));
  float n101 = hash(i + vec3(1.0,0.0,1.0));
  float n011 = hash(i + vec3(0.0,1.0,1.0));
  float n111 = hash(i + vec3(1.0,1.0,1.0));
  vec3 u = f*f*(3.0-2.0*f);
  return mix(mix(mix(n000,n100,u.x), mix(n010,n110,u.x), u.y),
             mix(mix(n001,n101,u.x), mix(n011,n111,u.x), u.y), u.z);
}

float fbm(vec3 p){
  float v = 0.0;
  float a = 0.5;
  for(int i=0;i<4;i++){
    v += a * noise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

void main(){
  vec3 p = v_pos * 0.1 + vec3(0.0, u_time * 0.02, 0.0);
  float d = fbm(p);
  float alpha = smoothstep(0.5, 0.9, d) * 0.08;
  gl_FragColor = vec4(vec3(0.9), alpha);
}
