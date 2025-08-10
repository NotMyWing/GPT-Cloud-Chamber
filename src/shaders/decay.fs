precision highp float;
varying vec2 v_uv;
uniform sampler2D u_prev;
uniform float u_decay; // 0.95..0.995
void main() {
  vec4 col = texture2D(u_prev, v_uv);
  gl_FragColor = vec4(col.rgb * u_decay, 1.0);
}
