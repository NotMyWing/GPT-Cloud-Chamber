precision highp float;
varying vec2 v_uv;
uniform sampler2D u_prev;
uniform float u_decay;
uniform vec2 u_texel;
void main(){
  vec4 col = texture2D(u_prev, v_uv) * 0.4;
  col += texture2D(u_prev, v_uv + u_texel * vec2(1.0, 0.0)) * 0.15;
  col += texture2D(u_prev, v_uv + u_texel * vec2(-1.0, 0.0)) * 0.15;
  col += texture2D(u_prev, v_uv + u_texel * vec2(0.0, 1.0)) * 0.15;
  col += texture2D(u_prev, v_uv + u_texel * vec2(0.0, -1.0)) * 0.15;
  gl_FragColor = vec4(col.rgb * u_decay, 1.0);
}
