#version 300 es
precision highp float;

in vec4 a_state1; // xyz, life
in vec4 a_state2; // vx vy vz type
in vec4 a_state3; // size, bright, active, qScale

uniform float u_dt;
uniform float u_bounds;
uniform float u_dragBase;
uniform float u_jitter;
uniform float u_B;

out vec4 v_state1;
out vec4 v_state2;
out vec4 v_state3;

float rand(float seed) {
  return fract(sin(seed) * 43758.5453123);
}

void main() {
  vec3 pos = a_state1.xyz;
  float life = a_state1.w;
  vec3 vel = a_state2.xyz;
  float type = a_state2.w;
  float size = a_state3.x;
  float bright = a_state3.y;
  float bActive = a_state3.z;
  float qScale = a_state3.w;

  if (bActive > 0.5) {
    float qBase = type > 0.5 ? 0.6 : 1.0;
    float q = qBase * qScale;
    vec3 Bvec = vec3(0.0, u_B, 0.0);
    vec3 acc = q * cross(vel, Bvec);
    vel += acc * u_dt;
    float drag = exp(-u_dragBase * u_dt);
    vel *= drag;
    float seed = float(gl_VertexID);
    vel += vec3(
      (rand(seed * 12.9898) * 2.0 - 1.0) * u_jitter * u_dt,
      (rand(seed * 78.233) * 2.0 - 1.0) * u_jitter * u_dt * 0.5,
      (rand(seed * 37.719) * 2.0 - 1.0) * u_jitter * u_dt
    );
    pos += vel * u_dt;
    life -= u_dt;
    bActive = (life > 0.0 && all(lessThan(abs(pos), vec3(u_bounds)))) ? 1.0 : 0.0;
    bright = bright * max(0.25, life * 0.15);
  }

  v_state1 = vec4(pos, life);
  v_state2 = vec4(vel, type);
  v_state3 = vec4(size, bright, bActive, qScale);
}
