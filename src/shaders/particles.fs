precision highp float;
varying float v_bright;
varying float v_type;

float hash(float n){ return fract(sin(n) * 43758.5453123); }
float noise(vec2 p){ return hash(p.x * 12.9898 + p.y * 78.233); }

void main(){
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  float density = exp(-2.5 * r * r);
  float n = noise(p + v_bright);
  density *= mix(0.7, 1.3, n);
  float core = mix(0.9, 1.3, v_type);
  float glow = mix(0.6, 1.0, v_type);
  vec3 col = vec3(1.0) * (v_bright * core * density);
  float alpha = density * glow;
  gl_FragColor = vec4(col, alpha);
}
