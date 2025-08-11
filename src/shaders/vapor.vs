attribute vec3 a_pos;
uniform mat4 u_viewProj;
varying vec3 v_pos;
void main(){
  v_pos = a_pos;
  gl_Position = u_viewProj * vec4(a_pos, 1.0);
}
