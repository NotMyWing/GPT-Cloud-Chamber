precision highp float;
varying vec2 v_phase;
uniform float u_time;

float hash(vec2 p){
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if(d > 0.5) discard;
  float n = noise((c * 4.0) + v_phase + u_time * 0.05);
  float alpha = smoothstep(0.5, 0.0, d) * (0.25 + 0.35 * n);
  gl_FragColor = vec4(vec3(0.9), alpha);
}
