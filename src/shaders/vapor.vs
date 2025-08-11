attribute vec3 a_pos;
uniform mat4 u_viewProj;
uniform float u_size;
void main(){
  gl_Position = u_viewProj * vec4(a_pos, 1.0);
  gl_PointSize = u_size;
}
