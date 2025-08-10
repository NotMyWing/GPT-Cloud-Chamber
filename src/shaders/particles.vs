precision highp float;

attribute vec3 a_pos;
attribute float a_size;
attribute float a_brightness;
attribute float a_type; // 0=beta,1=alpha
uniform mat4 u_viewProj;
varying float v_bright;
varying float v_type;

void main() {
  v_bright = a_brightness;
  v_type = a_type;
  vec4 clip = u_viewProj * vec4(a_pos, 1.0);
  gl_Position = clip;
  // perspective sizing
  float size = a_size / max(0.1, clip.w);
  gl_PointSize = size;
}
