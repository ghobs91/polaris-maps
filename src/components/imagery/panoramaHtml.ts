/** Default vertical field of view (degrees) for the panorama viewer. */
export const DEFAULT_FOV_DEG = 75;

/**
 * Builds a self-contained WebGL equirectangular viewer. Rendering the
 * panorama with a real perspective projection (rather than panning a flat
 * image) is what makes it a 3D street-view rather than a photo strip. Falls
 * back to a static, draggable image when WebGL or the texture upload is
 * unavailable (e.g. a source that doesn't send CORS headers).
 */
export function buildPanoramaHtml(
  imageUrl: string,
  yawDeg: number,
  pitchDeg: number,
  fovDeg: number,
): string {
  const img = JSON.stringify(imageUrl);
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const fov = (fovDeg * Math.PI) / 180;

  return `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>
  html,body{margin:0;height:100%;background:#000;overflow:hidden;touch-action:none}
  #c{display:block;width:100%;height:100%}
  #fb{position:absolute;inset:0;display:none;align-items:center;justify-content:center;overflow:hidden}
  #fb img{width:100%;height:100%;object-fit:cover;will-change:transform}
  #msg{position:absolute;left:0;right:0;bottom:10px;text-align:center;color:#ddd;
       font:12px -apple-system,system-ui,sans-serif;text-shadow:0 1px 2px #000;pointer-events:none}
</style>
</head>
<body>
<canvas id="c"></canvas>
<div id="fb"><img id="fbi" crossorigin="anonymous" /></div>
<div id="msg"></div>
<script>
(function () {
  var IMG = ${img};
  var yaw = ${yaw}, pitch = ${pitch}, fov = ${fov};
  var canvas = document.getElementById('c');
  var fb = document.getElementById('fb');
  var fbi = document.getElementById('fbi');
  var msg = document.getElementById('msg');

  function post(t) {
    try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: t })); } catch (e) {}
  }
  function fallback(reason) {
    canvas.style.display = 'none';
    fb.style.display = 'flex';
    fbi.src = IMG;
    msg.textContent = reason || '';
    post('fallback');
  }

  var gl = null;
  try { gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl'); } catch (e) {}
  if (!gl) { fallback('3D unavailable — showing flat preview'); return; }

  var VS = 'attribute vec2 aPos;void main(){gl_Position=vec4(aPos,0.0,1.0);}';
  var FS = [
    'precision highp float;',
    'uniform sampler2D uTex;uniform float uYaw;uniform float uPitch;uniform float uFov;uniform vec2 uRes;',
    'const float PI=3.141592653589793;',
    'void main(){',
    '  vec2 p=(gl_FragCoord.xy/uRes)*2.0-1.0;',
    '  float aspect=uRes.x/uRes.y;',
    '  float t=tan(uFov*0.5);',
    '  vec3 dir=vec3(p.x*aspect*t,p.y*t,-1.0);',
    '  float cp=cos(uPitch),sp=sin(uPitch);',
    '  dir=vec3(dir.x,dir.y*cp-dir.z*sp,dir.y*sp+dir.z*cp);',
    '  float cy=cos(uYaw),sy=sin(uYaw);',
    '  dir=vec3(dir.x*cy+dir.z*sy,dir.y,-dir.x*sy+dir.z*cy);',
    '  dir=normalize(dir);',
    '  float theta=atan(dir.x,-dir.z);',
    '  float phi=asin(clamp(dir.y,-1.0,1.0));',
    '  vec2 uv=vec2(theta/(2.0*PI)+0.5,0.5-phi/PI);',
    '  gl_FragColor=texture2D(uTex,uv);',
    '}'
  ].join('\\n');

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  var prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link failed');
    gl.useProgram(prog);
  } catch (e) { fallback('3D unavailable — showing flat preview'); return; }

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  var uYaw = gl.getUniformLocation(prog, 'uYaw');
  var uPitch = gl.getUniformLocation(prog, 'uPitch');
  var uFov = gl.getUniformLocation(prog, 'uFov');
  var uRes = gl.getUniformLocation(prog, 'uRes');

  var tex = gl.createTexture();
  var image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = function () {
    try {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      post('ready');
      render();
    } catch (e) { fallback('Preview only (image blocked cross-origin)'); }
  };
  image.onerror = function () { fallback('Panorama unavailable'); };
  image.src = IMG;

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.floor(canvas.clientWidth * dpr) || 1;
    var h = Math.floor(canvas.clientHeight * dpr) || 1;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  function render() {
    if (!gl) return;
    resize();
    gl.uniform1f(uYaw, yaw);
    gl.uniform1f(uPitch, pitch);
    gl.uniform1f(uFov, fov);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  var dragging = false, lastX = 0, lastY = 0, pinch = 0;
  function onDown(x, y) { dragging = true; lastX = x; lastY = y; }
  function onMove(x, y) {
    if (!dragging) return;
    yaw -= (x - lastX) * 0.005;
    pitch = Math.max(-1.2, Math.min(1.2, pitch + (y - lastY) * 0.005));
    lastX = x; lastY = y;
    render();
  }
  function onUp() { dragging = false; }

  canvas.addEventListener('pointerdown', function (e) { onDown(e.clientX, e.clientY); });
  window.addEventListener('pointermove', function (e) { onMove(e.clientX, e.clientY); });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('wheel', function (e) {
    e.preventDefault();
    fov = Math.max(0.6, Math.min(1.8, fov + e.deltaY * 0.0015));
    render();
  }, { passive: false });
  window.addEventListener('touchmove', function (e) {
    if (e.touches.length === 2) {
      e.preventDefault();
      var dx = e.touches[0].clientX - e.touches[1].clientX;
      var dy = e.touches[0].clientY - e.touches[1].clientY;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (pinch) { fov = Math.max(0.6, Math.min(1.8, fov - (d - pinch) * 0.004)); render(); }
      pinch = d;
    }
  }, { passive: false });
  window.addEventListener('touchend', function () { pinch = 0; });

  // Flat fallback panning.
  var fbDown = false, fbX = 0, fbOff = 0;
  fb.addEventListener('pointerdown', function (e) { fbDown = true; fbX = e.clientX; });
  window.addEventListener('pointermove', function (e) {
    if (!fbDown) return;
    fbOff += e.clientX - fbX; fbX = e.clientX;
    fbi.style.transform = 'translateX(' + fbOff * 0.5 + 'px)';
  });
  window.addEventListener('pointerup', function () { fbDown = false; });

  render();
})();
</script>
</body>
</html>`;
}
