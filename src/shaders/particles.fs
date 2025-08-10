precision highp float;
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
