precision highp float;
attribute vec3 a_pos;
attribute float a_size;
attribute float a_brightness;
attribute float a_type; // 0=beta,1=alpha
attribute float a_active;
uniform mat4 u_viewProj;
uniform float u_dpr;
varying float v_bright;
varying float v_type;
void main(){
  v_bright = a_brightness;
  v_type = a_type;
  // Cull inactive particles by moving them off-screen and giving them a size
  // of zero. This allows us to draw a fixed number of vertices every frame
  // without updating an index buffer.
  if (a_active < 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  vec4 clip = u_viewProj * vec4(a_pos, 1.0);
  gl_Position = clip;
  float size = (a_size * u_dpr) / max(0.1, clip.w);
  gl_PointSize = size;
}
