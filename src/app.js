const CONFIG = {
  maxHands: 2,
  modelUrl:
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
  visionBundleUrl:
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs",
  wasmUrl: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm",
  targetFps: 58,
  mobileDetectionInterval: 44,
  desktopDetectionInterval: 36,
};

const canvas = document.querySelector("#particle-canvas");
const video = document.querySelector("#camera");
const panel = document.querySelector(".permission-panel");
const statusText = document.querySelector("#status-text");
const hintText = document.querySelector("#hint-text");
const startButton = document.querySelector("#start-camera");
const fpsMeter = document.querySelector("#fps-meter");
const ctx = canvas.getContext("2d");

const TAU = Math.PI * 2;
const LANDMARK = {
  wrist: 0,
  thumbTip: 4,
  indexMcp: 5,
  indexPip: 6,
  indexTip: 8,
  middleMcp: 9,
  middlePip: 10,
  middleTip: 12,
  ringPip: 14,
  ringTip: 16,
  pinkyMcp: 17,
  pinkyPip: 18,
  pinkyTip: 20,
};

const isMobile =
  matchMedia("(max-width: 760px)").matches ||
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const lowMemory = navigator.deviceMemory && navigator.deviceMemory <= 4;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const localhost = ["localhost", "127.0.0.1", "::1"].includes(location.hostname);

let width = 1;
let height = 1;
let dpr = 1;
let particles = [];
let targetParticleCount = 0;
let handLandmarker = null;
let cameraStream = null;
let latestHands = [];
let previousHands = new Map();
let touchControls = [];
let activePointers = new Map();
let animationStarted = false;
let detectionStarted = false;
let lastVideoTime = -1;
let lastDetectionAt = 0;
let lastFrameAt = performance.now();
let fps = 60;
let fpsStableCounter = 0;
let fallbackMode = true;
let cameraReady = false;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalize(x, y) {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

function setStatus(message, mode = "pending", hint = "") {
  statusText.textContent = message;
  panel.classList.toggle("is-ready", mode === "ready");
  panel.classList.toggle("is-error", mode === "error");
  if (hint) {
    hintText.textContent = hint;
  }
}

function getErrorCopy(error) {
  if (!window.isSecureContext && !localhost) {
    return {
      title: "需要 HTTPS 才能使用摄像头",
      hint: "请部署到 Vercel 或 Netlify 后，用 https:// 开头的网址在手机 Chrome 打开。",
    };
  }

  const copy = {
    NotAllowedError: {
      title: "摄像头权限未开启",
      hint: "请在 Chrome 地址栏左侧的网站设置中允许摄像头，然后点击按钮重试。",
    },
    NotFoundError: {
      title: "没有找到可用摄像头",
      hint: "页面会继续播放备用粒子动画，也可以连接摄像头后重试。",
    },
    NotReadableError: {
      title: "摄像头正在被占用",
      hint: "请关闭其他使用摄像头的应用，再点击按钮重试。",
    },
    OverconstrainedError: {
      title: "前置摄像头不可用",
      hint: "已准备使用浏览器默认摄像头，请点击按钮重试。",
    },
  };

  return (
    copy[error?.name] || {
      title: "手势识别暂不可用",
      hint: "备用粒子动画仍会运行。你也可以用手指触摸屏幕体验粒子流动。",
    }
  );
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function getParticleBudget() {
  const area = width * height;
  const density = lowMemory ? 1850 : isMobile ? 1450 : 1500;
  const min = lowMemory ? 260 : isMobile ? 380 : 520;
  const max = lowMemory ? 620 : isMobile ? 980 : 1350;
  const motionFactor = reducedMotion ? 0.68 : 1;
  return Math.round(clamp((area / density) * motionFactor, min, max));
}

function makeParticle(index) {
  const originX = Math.random() * width;
  const originY = Math.random() * height;
  const palette = [
    [215, 161, 141],
    [143, 188, 202],
    [240, 216, 202],
    [154, 184, 169],
    [255, 255, 255],
  ];

  return {
    originX,
    originY,
    x: originX + randomBetween(-18, 18),
    y: originY + randomBetween(-18, 18),
    vx: randomBetween(-0.1, 0.1),
    vy: randomBetween(-0.1, 0.1),
    radius: randomBetween(isMobile ? 1.2 : 1.1, isMobile ? 2.6 : 3),
    phase: randomBetween(0, TAU),
    drift: randomBetween(0.08, 0.3),
    color: palette[index % palette.length],
    alpha: randomBetween(0.34, 0.78),
  };
}

function resizeCanvas() {
  const previousWidth = width;
  const previousHeight = height;
  width = Math.max(1, window.innerWidth);
  height = Math.max(1, window.innerHeight);
  dpr = Math.min(window.devicePixelRatio || 1, isMobile || lowMemory ? 1.45 : 2);

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  targetParticleCount = getParticleBudget();

  if (!particles.length) {
    particles = Array.from({ length: targetParticleCount }, (_, index) =>
      makeParticle(index),
    );
    return;
  }

  const ratioX = width / Math.max(previousWidth, 1);
  const ratioY = height / Math.max(previousHeight, 1);
  particles = particles.slice(0, targetParticleCount).map((particle) => ({
    ...particle,
    originX: clamp(particle.originX * ratioX, 0, width),
    originY: clamp(particle.originY * ratioY, 0, height),
    x: clamp(particle.x * ratioX, -80, width + 80),
    y: clamp(particle.y * ratioY, -80, height + 80),
  }));

  while (particles.length < targetParticleCount) {
    particles.push(makeParticle(particles.length));
  }
}

function tuneParticleBudget() {
  fpsStableCounter += 1;
  if (fpsStableCounter < 90) {
    return;
  }

  fpsStableCounter = 0;
  const floor = lowMemory ? 220 : isMobile ? 320 : 420;
  if (fps < 34 && particles.length > floor) {
    particles = particles.slice(0, Math.max(floor, Math.round(particles.length * 0.9)));
    targetParticleCount = particles.length;
  } else if (fps > 52 && particles.length < getParticleBudget()) {
    const nextCount = Math.min(getParticleBudget(), particles.length + 42);
    while (particles.length < nextCount) {
      particles.push(makeParticle(particles.length));
    }
    targetParticleCount = particles.length;
  }
}

function mapLandmark(landmark) {
  return {
    x: (1 - landmark.x) * width,
    y: landmark.y * height,
    z: landmark.z || 0,
  };
}

function getBounds(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return {
    width: maxX - minX,
    height: maxY - minY,
    diagonal: Math.hypot(maxX - minX, maxY - minY),
  };
}

function getPalmCenter(points) {
  const ids = [LANDMARK.wrist, LANDMARK.indexMcp, LANDMARK.middleMcp, LANDMARK.pinkyMcp];
  const center = ids.reduce(
    (total, id) => {
      total.x += points[id].x;
      total.y += points[id].y;
      return total;
    },
    { x: 0, y: 0 },
  );
  return { x: center.x / ids.length, y: center.y / ids.length };
}

function countExtendedFingers(points, palm, scale) {
  const fingers = [
    [LANDMARK.thumbTip, 3, 0.04],
    [LANDMARK.indexTip, LANDMARK.indexPip, 0.052],
    [LANDMARK.middleTip, LANDMARK.middlePip, 0.052],
    [LANDMARK.ringTip, LANDMARK.ringPip, 0.048],
    [LANDMARK.pinkyTip, LANDMARK.pinkyPip, 0.044],
  ];

  return fingers.reduce((count, [tipId, jointId, bias]) => {
    const tipDistance = distance(points[tipId], palm);
    const jointDistance = distance(points[jointId], palm);
    return count + (tipDistance > jointDistance + scale * bias ? 1 : 0);
  }, 0);
}

function buildHandControl(landmarks, handedness, now) {
  const points = landmarks.map(mapLandmark);
  const bounds = getBounds(points);
  const scale = clamp(bounds.diagonal, 76, Math.min(width, height) * 0.78);
  const palm = getPalmCenter(points);
  const index = points[LANDMARK.indexTip];
  const thumb = points[LANDMARK.thumbTip];
  const pinchPoint = {
    x: (index.x + thumb.x) / 2,
    y: (index.y + thumb.y) / 2,
  };
  const pinchDistance = distance(index, thumb);
  const pinchStrength = clamp((scale * 0.28 - pinchDistance) / (scale * 0.16), 0, 1);
  const extendedFingers = countExtendedFingers(points, palm, scale);
  const spread = distance(points[LANDMARK.indexTip], points[LANDMARK.pinkyTip]);
  const previous = previousHands.get(handedness);
  const velocity = previous
    ? {
        x: lerp(previous.indexVelocity.x, index.x - previous.index.x, 0.35),
        y: lerp(previous.indexVelocity.y, index.y - previous.index.y, 0.35),
      }
    : { x: 0, y: 0 };

  let mode = "palm";
  if (pinchStrength > 0.62) {
    mode = "pinch";
  } else if (extendedFingers >= 4 && spread > scale * 0.42) {
    mode = "open";
  }

  return {
    type: "camera",
    key: handedness,
    mode,
    palm,
    index,
    pinchPoint,
    pinchStrength,
    scale,
    closeness: clamp((scale - Math.min(width, height) * 0.18) / 230, 0, 1),
    indexVelocity: velocity,
    trail: previous
      ? [{ x: index.x, y: index.y, life: 1 }, ...previous.trail.slice(0, 10)]
      : [{ x: index.x, y: index.y, life: 1 }],
  };
}

function updateHands(result, now) {
  const hands = result?.landmarks || [];
  const handednesses = result?.handednesses || [];
  const nextMap = new Map();

  latestHands = hands.slice(0, CONFIG.maxHands).map((landmarks, index) => {
    const handedness = handednesses[index]?.[0]?.categoryName || `hand-${index}`;
    const control = buildHandControl(landmarks, handedness, now);
    control.trail = control.trail.map((point, trailIndex) => ({
      ...point,
      life: Math.max(0, 1 - trailIndex / 11),
    }));
    nextMap.set(control.key, control);
    return control;
  });

  previousHands = nextMap;
  fallbackMode = !latestHands.length;

  if (cameraReady) {
    setStatus(
      latestHands.length ? "正在识别手势" : "等待手势",
      "ready",
      latestHands.length
        ? "移动食指、靠近手掌或做捏合动作，粒子会柔和响应。"
        : "把手放在手机前置摄像头前，或直接触摸屏幕体验备用交互。",
    );
  }
}

function updateTouchControls(now) {
  const pointers = [...activePointers.values()];
  if (!pointers.length) {
    touchControls = [];
    return;
  }

  if (pointers.length >= 2) {
    const [first, second] = pointers;
    const center = {
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
    };
    touchControls = [
      {
        type: "touch",
        key: "touch-pinch",
        mode: distance(first, second) < Math.min(width, height) * 0.28 ? "pinch" : "open",
        palm: center,
        index: center,
        pinchPoint: center,
        pinchStrength: 0.86,
        scale: Math.min(width, height) * 0.42,
        closeness: 0.8,
        indexVelocity: {
          x: ((first.vx || 0) + (second.vx || 0)) / 2,
          y: ((first.vy || 0) + (second.vy || 0)) / 2,
        },
        trail: [{ x: center.x, y: center.y, life: 1 }],
      },
    ];
    return;
  }

  const pointer = pointers[0];
  const previous = touchControls[0];
  const velocity = previous
    ? {
        x: lerp(previous.indexVelocity.x, pointer.x - previous.index.x, 0.4),
        y: lerp(previous.indexVelocity.y, pointer.y - previous.index.y, 0.4),
      }
    : { x: pointer.vx || 0, y: pointer.vy || 0 };

  touchControls = [
    {
      type: "touch",
      key: "touch",
      mode: "palm",
      palm: { x: pointer.x, y: pointer.y },
      index: { x: pointer.x, y: pointer.y },
      pinchPoint: { x: pointer.x, y: pointer.y },
      pinchStrength: 0,
      scale: Math.min(width, height) * 0.36,
      closeness: 0.56,
      indexVelocity: velocity,
      trail: previous
        ? [{ x: pointer.x, y: pointer.y, life: 1 }, ...previous.trail.slice(0, 9)]
        : [{ x: pointer.x, y: pointer.y, life: 1 }],
    },
  ].map((control) => ({
    ...control,
    trail: control.trail.map((point, trailIndex) => ({
      ...point,
      life: Math.max(0, 1 - trailIndex / 10),
    })),
  }));
}

async function loadHandLandmarker() {
  if (handLandmarker) {
    return handLandmarker;
  }

  setStatus("正在加载手势模型", "pending", "首次打开需要下载 MediaPipe 模型，请保持网络连接。");
  const { FilesetResolver, HandLandmarker } = await import(CONFIG.visionBundleUrl);
  const filesetResolver = await FilesetResolver.forVisionTasks(CONFIG.wasmUrl);
  handLandmarker = await HandLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath: CONFIG.modelUrl,
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: CONFIG.maxHands,
    minHandDetectionConfidence: 0.55,
    minHandPresenceConfidence: 0.55,
    minTrackingConfidence: 0.52,
  });
  return handLandmarker;
}

async function requestCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("MEDIA_DEVICES_UNSUPPORTED");
  }

  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
  }

  const constraints = {
    audio: false,
    video: {
      facingMode: { ideal: "user" },
      width: { ideal: isMobile ? 640 : 960, max: 1280 },
      height: { ideal: isMobile ? 480 : 720, max: 720 },
      frameRate: { ideal: 30, max: 30 },
    },
  };

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (error) {
    if (error.name === "OverconstrainedError") {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: true,
      });
    } else {
      throw error;
    }
  }

  video.srcObject = cameraStream;
  await video.play();
  cameraReady = true;
  fallbackMode = false;
}

async function startGestureTracking() {
  startButton.disabled = true;
  setStatus("正在请求摄像头权限", "pending", "请在弹出的权限窗口中选择允许。");

  try {
    await loadHandLandmarker();
    await requestCamera();
    startDetectionLoop();
    setStatus(
      "手势识别已开启",
      "ready",
      "摄像头画面已隐藏。移动食指、张开手掌或捏合手指试试看。",
    );
    startButton.textContent = "重新连接摄像头";
    startButton.disabled = false;
  } catch (error) {
    console.warn("Gesture camera is unavailable.", error);
    fallbackMode = true;
    cameraReady = false;
    const copy =
      error.message === "MEDIA_DEVICES_UNSUPPORTED"
        ? {
            title: "当前浏览器不支持摄像头",
            hint: "请使用手机 Google Chrome，并确认页面是 HTTPS 地址。",
          }
        : getErrorCopy(error);
    setStatus(copy.title, "error", `${copy.hint} 备用粒子动画和触摸交互仍可使用。`);
    startButton.textContent = "重试摄像头";
    startButton.disabled = false;
  }
}

function detectHands(now) {
  const interval = isMobile || lowMemory
    ? CONFIG.mobileDetectionInterval
    : CONFIG.desktopDetectionInterval;

  if (
    handLandmarker &&
    cameraReady &&
    now - lastDetectionAt >= interval &&
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    video.currentTime !== lastVideoTime
  ) {
    lastDetectionAt = now;
    lastVideoTime = video.currentTime;
    updateHands(handLandmarker.detectForVideo(video, now), now);
  }

  requestAnimationFrame(detectHands);
}

function startDetectionLoop() {
  if (detectionStarted) {
    return;
  }

  detectionStarted = true;
  requestAnimationFrame(detectHands);
}

function applyPalmRepulsion(particle, control) {
  if (control.mode === "pinch") {
    return;
  }

  const radius = clamp(control.scale * 0.9, 108, isMobile ? 260 : 320);
  const dx = particle.x - control.palm.x;
  const dy = particle.y - control.palm.y;
  const dist = Math.hypot(dx, dy);
  if (dist > radius || dist < 1) {
    return;
  }

  const falloff = (1 - dist / radius) ** 2;
  const direction = normalize(dx, dy);
  const strength = falloff * (0.58 + control.closeness * 0.64);
  particle.vx += direction.x * strength;
  particle.vy += direction.y * strength;
}

function applyIndexFlow(particle, control) {
  const velocity = Math.hypot(control.indexVelocity.x, control.indexVelocity.y);
  const radius = clamp(118 + velocity * 3.1, 126, isMobile ? 250 : 300);
  const flow = normalize(control.indexVelocity.x, control.indexVelocity.y);

  for (const trailPoint of control.trail) {
    const dx = trailPoint.x - particle.x;
    const dy = trailPoint.y - particle.y;
    const dist = Math.hypot(dx, dy);
    if (dist > radius || dist < 1) {
      continue;
    }

    const falloff = (1 - dist / radius) * trailPoint.life;
    const toward = normalize(dx, dy);
    particle.vx += toward.x * falloff * 0.044;
    particle.vy += toward.y * falloff * 0.044;
    particle.vx += flow.x * falloff * 0.48;
    particle.vy += flow.y * falloff * 0.48;
  }
}

function applyPinchAttraction(particle, control) {
  if (control.mode !== "pinch") {
    return;
  }

  const radius = clamp(control.scale * 1.26, 172, isMobile ? 330 : 410);
  const dx = control.pinchPoint.x - particle.x;
  const dy = control.pinchPoint.y - particle.y;
  const dist = Math.hypot(dx, dy);
  if (dist > radius || dist < 1) {
    return;
  }

  const falloff = (1 - dist / radius) ** 1.42;
  particle.vx += dx * 0.035 * falloff * control.pinchStrength;
  particle.vy += dy * 0.035 * falloff * control.pinchStrength;
}

function applyOpenSpread(particle, control) {
  if (control.mode !== "open") {
    return;
  }

  const radius = clamp(control.scale * 1.16, 156, isMobile ? 310 : 380);
  const dx = particle.x - control.palm.x;
  const dy = particle.y - control.palm.y;
  const dist = Math.hypot(dx, dy);
  if (dist > radius || dist < 1) {
    return;
  }

  const falloff = (1 - dist / radius) ** 1.8;
  const direction = normalize(dx, dy);
  particle.vx += direction.x * falloff * 0.9;
  particle.vy += direction.y * falloff * 0.9;
}

function getControls(now) {
  updateTouchControls(now);
  return latestHands.length ? [...latestHands, ...touchControls] : touchControls;
}

function updateParticle(particle, controls, now) {
  const driftX = Math.cos(now * 0.00042 + particle.phase) * particle.drift;
  const driftY = Math.sin(now * 0.00036 + particle.phase * 1.31) * particle.drift;
  const homeStrength = fallbackMode ? 0.0052 : 0.0076;

  particle.vx += (particle.originX - particle.x) * homeStrength + driftX * 0.012;
  particle.vy += (particle.originY - particle.y) * homeStrength + driftY * 0.012;

  for (const control of controls) {
    applyIndexFlow(particle, control);
    applyPalmRepulsion(particle, control);
    applyPinchAttraction(particle, control);
    applyOpenSpread(particle, control);
  }

  particle.vx *= 0.925;
  particle.vy *= 0.925;
  particle.x += particle.vx;
  particle.y += particle.vy;

  if (particle.x < -70 || particle.x > width + 70) {
    particle.vx *= -0.38;
    particle.x = clamp(particle.x, -70, width + 70);
  }

  if (particle.y < -70 || particle.y > height + 70) {
    particle.vy *= -0.38;
    particle.y = clamp(particle.y, -70, height + 70);
  }
}

function drawControlGlow(control) {
  const point = control.mode === "pinch" ? control.pinchPoint : control.palm;
  const radius = control.mode === "pinch" ? 150 : 126;
  const alpha = control.mode === "pinch" ? 0.23 : 0.09;
  const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
  gradient.addColorStop(0, `rgba(255, 246, 238, ${alpha})`);
  gradient.addColorStop(0.45, `rgba(215, 161, 141, ${alpha * 0.34})`);
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, TAU);
  ctx.fill();
}

function drawParticles(controls, now) {
  ctx.clearRect(0, 0, width, height);
  ctx.globalCompositeOperation = "source-over";

  for (const control of controls) {
    drawControlGlow(control);
  }

  ctx.globalCompositeOperation = "lighter";
  for (const particle of particles) {
    const twinkle = 0.74 + Math.sin(now * 0.0011 + particle.phase) * 0.16;
    const [r, g, b] = particle.color;
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${particle.alpha * twinkle})`;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.radius * twinkle, 0, TAU);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
}

function animate(now) {
  const delta = Math.max(1, now - lastFrameAt);
  lastFrameAt = now;
  fps = lerp(fps, 1000 / delta, 0.08);
  fpsMeter.textContent = `FPS ${Math.round(fps)}`;
  tuneParticleBudget();

  const controls = getControls(now);
  for (const particle of particles) {
    updateParticle(particle, controls, now);
  }
  drawParticles(controls, now);
  requestAnimationFrame(animate);
}

function startAnimation() {
  if (animationStarted) {
    return;
  }

  animationStarted = true;
  requestAnimationFrame(animate);
}

function addPointer(event) {
  if (event.target === startButton) {
    return;
  }

  activePointers.set(event.pointerId, {
    x: event.clientX,
    y: event.clientY,
    vx: 0,
    vy: 0,
  });
}

function movePointer(event) {
  const previous = activePointers.get(event.pointerId);
  if (!previous) {
    return;
  }

  activePointers.set(event.pointerId, {
    x: event.clientX,
    y: event.clientY,
    vx: event.clientX - previous.x,
    vy: event.clientY - previous.y,
  });
}

function removePointer(event) {
  activePointers.delete(event.pointerId);
}

function boot() {
  resizeCanvas();
  startAnimation();

  if (!window.isSecureContext && !localhost) {
    const copy = getErrorCopy();
    setStatus(copy.title, "error", `${copy.hint} 当前页面先展示备用粒子动画。`);
    startButton.textContent = "需要 HTTPS";
    return;
  }

  setStatus(
    "请开启摄像头权限",
    "pending",
    "手机 Chrome 会优先使用前置摄像头。无法识别时也可以触摸屏幕互动。",
  );
  startGestureTracking();
}

window.addEventListener("resize", resizeCanvas, { passive: true });
window.addEventListener("orientationchange", () => setTimeout(resizeCanvas, 250), {
  passive: true,
});
window.addEventListener("pointerdown", addPointer, { passive: true });
window.addEventListener("pointermove", movePointer, { passive: true });
window.addEventListener("pointerup", removePointer, { passive: true });
window.addEventListener("pointercancel", removePointer, { passive: true });

startButton.addEventListener("click", startGestureTracking);

boot();
