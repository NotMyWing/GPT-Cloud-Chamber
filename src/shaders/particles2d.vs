precision highp float;
attribute vec3 a_pos;
attribute float a_size;
attribute float a_brightness;
attribute float a_type;
uniform float u_bounds;
varying float v_bright;
varying float v_type;
void main(){
  v_bright = a_brightness;
  v_type = a_type;
  gl_Position = vec4(a_pos.x/u_bounds, a_pos.z/u_bounds, 0.0, 1.0);
  gl_PointSize = a_size;
}
