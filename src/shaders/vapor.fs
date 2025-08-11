precision highp float;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if(d > 0.5) discard;
  float alpha = (0.5 - d) * 0.3;
  gl_FragColor = vec4(0.8,0.8,0.85, alpha);
}
