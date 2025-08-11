precision highp float;
varying vec3 v_norm;
varying vec3 v_pos;
uniform vec3 u_eye;
void main(){
  vec3 N = normalize(v_norm);
  vec3 V = normalize(u_eye - v_pos);
  vec3 Nf = faceforward(N, V, N);
  float fres = pow(1.0 - max(dot(V, Nf), 0.0), 5.0);
  vec3 tint = vec3(0.4, 0.6, 0.7) * 0.15;
  vec3 refl = vec3(0.9);
  vec3 col = mix(tint, refl, fres);
  float spec = pow(max(dot(reflect(-V, Nf), vec3(0.0,0.0,1.0)), 0.0), 16.0);
  col += vec3(spec);
  gl_FragColor = vec4(col, 0.15 + 0.15 * fres);
}
