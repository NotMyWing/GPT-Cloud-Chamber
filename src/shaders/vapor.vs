attribute vec3 a_pos;
attribute vec2 a_phase;
uniform mat4 u_viewProj;
uniform float u_size;
varying vec2 v_phase;
void main(){
  v_phase = a_phase;
  gl_Position = u_viewProj * vec4(a_pos, 1.0);
  gl_PointSize = u_size;
}
