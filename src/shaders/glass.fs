precision highp float;
varying vec3 v_norm;
varying vec3 v_pos;
uniform vec3 u_eye;
void main(){
  vec3 N = normalize(v_norm);
  vec3 V = normalize(u_eye - v_pos);
  float fres = pow(1.0 - max(dot(V, N), 0.0), 3.0);
  vec3 base = vec3(0.4,0.6,0.7) * 0.2;
  vec3 refl = vec3(0.9);
  vec3 col = mix(base, refl, fres);
  gl_FragColor = vec4(col, 0.2);
}
