precision highp float;
varying float v_bright;
varying float v_type;
uniform float u_time;

float hash(float n){ return fract(sin(n) * 43758.5453123); }
float noise(vec2 p){ return hash(p.x * 12.9898 + p.y * 78.233); }

void main(){
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  float density = exp(-2.5 * r * r);
  float n = noise(p + v_bright);
  density *= mix(0.7, 1.3, n);
  float sparkle = step(0.95, noise(p * 40.0 + u_time * 5.0));
  float core = mix(0.9, 1.5, v_type);
  float glow = mix(1.0, 1.4, v_type);
  vec3 betaCol = vec3(0.3, 0.7, 1.0);
  vec3 alphaCol = vec3(1.0, 0.5, 0.1);
  vec3 col = mix(betaCol, alphaCol, v_type);
  float brightness = v_bright * core * (1.2 + sparkle * 0.8);
  float alpha = density * glow * (1.4 + sparkle * 0.5);
  gl_FragColor = vec4(col * brightness * density, alpha);
}
