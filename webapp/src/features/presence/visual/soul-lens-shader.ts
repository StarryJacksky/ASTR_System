/** GLSL 100: a clip-space quad with one transparent, analytical Soul Lens pass. */
export const SOUL_LENS_VERTEX_SHADER = `
precision mediump float;

attribute vec2 aVertexPosition;
varying vec2 vUv;

void main(void) {
  vUv = aVertexPosition * 0.5 + 0.5;
  gl_Position = vec4(aVertexPosition, 0.0, 1.0);
}
`;

export const SOUL_LENS_FRAGMENT_SHADER = `
precision mediump float;

varying vec2 vUv;

uniform vec2 uViewport;
uniform float uTime;
uniform float uMotion;
uniform vec2 uStageSignature;
uniform vec2 uModelSignature;
uniform float uModelPresent;
uniform float uProvenanceState;
uniform float uLightMaterial;

const float PI = 3.14159265359;

float ring(float radius, float target, float width) {
  return 1.0 - smoothstep(width, width * 2.0, abs(radius - target));
}

float lineSegment(vec2 point, vec2 start, vec2 end, float width) {
  vec2 axis = end - start;
  float position = clamp(dot(point - start, axis) / dot(axis, axis), 0.0, 1.0);
  return 1.0 - smoothstep(width, width * 2.0, length(point - start - axis * position));
}

float facet(vec2 point, float angle, float radius) {
  vec2 q = point;
  float c = cos(angle);
  float s = sin(angle);
  q = mat2(c, -s, s, c) * q;
  float diamond = abs(q.x) * 0.82 + abs(q.y);
  return 1.0 - smoothstep(radius, radius + 0.012, diamond);
}

void main(void) {
  float shortest = max(1.0, min(uViewport.x, uViewport.y));
  float aspect = uViewport.x / max(1.0, uViewport.y);
  vec2 point = vUv - 0.5;
  point.x *= aspect;
  float radius = length(point);
  float angle = atan(point.y, point.x);
  float antialias = 1.6 / shortest;

  float breath = sin(uTime * 1.35 + uStageSignature.x * PI) * 0.006 * uMotion;
  float identityRadius = 0.105;
  float identity = 1.0 - smoothstep(identityRadius, identityRadius + antialias * 5.0, radius);
  float identityEdge = ring(radius, identityRadius, antialias * 2.0);

  float shellRadius = 0.225 + (uModelSignature.x - 0.5) * 0.018 + breath;
  float shell = ring(radius, shellRadius, 0.006 + antialias);
  float shellFacet = facet(point, uModelSignature.y * PI, shellRadius * 0.92);
  shellFacet *= 1.0 - smoothstep(shellRadius * 0.82, shellRadius, radius);
  shell *= mix(0.38, 1.0, uModelPresent);

  float outerRadius = 0.34;
  float notchAngle = 0.48;
  float notch = 1.0 - smoothstep(0.025, 0.065, abs(angle - notchAngle));
  float outer = ring(radius, outerRadius, 0.0045 + antialias) * (1.0 - notch);
  float provenanceEvidence = step(0.5, uProvenanceState);
  outer *= mix(0.34, 1.0, provenanceEvidence);

  vec2 notchA = vec2(cos(notchAngle - 0.11), sin(notchAngle - 0.11)) * outerRadius;
  vec2 notchB = vec2(cos(notchAngle + 0.11), sin(notchAngle + 0.11)) * outerRadius;
  vec2 notchTip = vec2(cos(notchAngle), sin(notchAngle)) * (outerRadius - 0.055);
  float brokenSeal = max(
    lineSegment(point, notchA, notchTip, 0.0035),
    lineSegment(point, notchTip, notchB, 0.0035)
  );
  brokenSeal *= 1.0 - provenanceEvidence;

  float stageArc = ring(radius, outerRadius - 0.035, 0.0035 + antialias);
  float arcPhase = fract((angle / (2.0 * PI)) + 0.5 + uStageSignature.y * 0.37 + uTime * 0.035 * uMotion);
  stageArc *= smoothstep(0.04, 0.09, arcPhase) * (1.0 - smoothstep(0.42, 0.49, arcPhase));

  float axis = 0.0;
  axis = max(axis, lineSegment(point, vec2(0.0, -0.31), vec2(0.0, -0.27), 0.0017));
  axis = max(axis, lineSegment(point, vec2(0.0, 0.27), vec2(0.0, 0.31), 0.0017));
  axis = max(axis, lineSegment(point, vec2(-0.31, 0.0), vec2(-0.27, 0.0), 0.0017));
  axis = max(axis, lineSegment(point, vec2(0.27, 0.0), vec2(0.31, 0.0), 0.0017));

  vec3 midnight = mix(vec3(0.012, 0.016, 0.075), vec3(0.86, 0.89, 0.99), uLightMaterial);
  vec3 astralBlue = mix(vec3(0.10, 0.32, 1.0), vec3(0.035, 0.19, 0.72), uLightMaterial);
  vec3 ultraviolet = mix(vec3(0.55, 0.24, 1.0), vec3(0.31, 0.12, 0.68), uLightMaterial);
  vec3 stellarWhite = mix(vec3(0.82, 0.88, 1.0), vec3(0.08, 0.10, 0.25), uLightMaterial);

  float coreLight = identity * (0.28 + 0.18 * (1.0 - radius / identityRadius));
  vec3 color = midnight * coreLight;
  color += mix(astralBlue, ultraviolet, uStageSignature.x) * identityEdge * 0.92;
  color += mix(ultraviolet, astralBlue, uModelSignature.x) * shell * 0.76;
  color += mix(astralBlue, stellarWhite, 0.32) * shellFacet * 0.14 * uModelPresent;
  color += stellarWhite * outer * 0.58;
  color += ultraviolet * brokenSeal * 0.42;
  color += astralBlue * stageArc * (0.38 + 0.32 * uMotion);
  color += stellarWhite * axis * 0.46;

  float alpha = clamp(
    max(coreLight, max(identityEdge, max(shell, max(shellFacet * 0.2, max(outer, max(brokenSeal, max(stageArc, axis))))))),
    0.0,
    1.0
  );
  gl_FragColor = vec4(color * alpha, alpha);
}
`;
