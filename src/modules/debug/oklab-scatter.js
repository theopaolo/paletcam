/**
 * Reusable OKLab 3D scatter renderer (Canvas 2D, orthographic).
 *
 * Axes match the perceptual layout: L is vertical, a (green<->red) and
 * b (blue<->yellow) form the horizontal plane. Drag to orbit, wheel to zoom.
 *
 * The renderer is data-agnostic: feed it a scene of points / markers / spheres
 * in OKLab coordinates and it projects + draws them. Selection logic lives
 * elsewhere; this only visualizes.
 */

const AXIS_COLORS = {
  a: { pos: "#d05a6e", neg: "#5aa469" }, // +a red / -a green
  b: { pos: "#b7b34a", neg: "#6f74c4" }, // +b yellow / -b blue
  L: "rgb(255 255 255 / 35%)",
};

function rgbCss({ r, g, b }) {
  return `rgb(${r} ${g} ${b})`;
}

export function createOklabScatter(canvas) {
  const ctx = canvas.getContext("2d");

  const DEFAULT_YAW = -0.6;
  const DEFAULT_PITCH = 0.5;

  let scene = { points: [], markers: [], spheres: [] };
  let yaw = DEFAULT_YAW;
  let pitch = DEFAULT_PITCH;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let frame = 0;

  // Project an OKLab point to a rotated 3D space, then orthographically to 2D.
  // World axes: x = a, y = L (centered on 0.5), z = b.
  function project({ L, a, b }) {
    const x = a;
    const y = L - 0.5;
    const z = b;

    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const x1 = x * cosY + z * sinY;
    const z1 = -x * sinY + z * cosY;

    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);
    const y2 = y * cosP - z1 * sinP;
    const z2 = y * sinP + z1 * cosP;

    const { width, height } = canvas;
    const scale = Math.min(width, height) * 0.62 * zoom;

    return {
      sx: width / 2 + panX + x1 * scale,
      sy: height / 2 + panY - y2 * scale,
      depth: z2,
      scale,
    };
  }

  function drawAxis(from, to, color, label) {
    const a = project(from);
    const b = project(to);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a.sx, a.sy);
    ctx.lineTo(b.sx, b.sy);
    ctx.stroke();
    if (label) {
      ctx.fillStyle = color;
      ctx.font = "11px monospace";
      ctx.fillText(label, b.sx + 4, b.sy);
    }
  }

  function drawAxes() {
    drawAxis({ L: 0.5, a: -0.45, b: 0 }, { L: 0.5, a: 0.45, b: 0 }, AXIS_COLORS.a.pos, "+a red");
    drawAxis({ L: 0.5, a: 0.45, b: 0 }, { L: 0.5, a: -0.45, b: 0 }, AXIS_COLORS.a.neg, "-a green");
    drawAxis({ L: 0.5, a: 0, b: -0.45 }, { L: 0.5, a: 0, b: 0.45 }, AXIS_COLORS.b.pos, "+b yellow");
    drawAxis({ L: 0.5, a: 0, b: 0.45 }, { L: 0.5, a: 0, b: -0.45 }, AXIS_COLORS.b.neg, "-b blue");
    drawAxis({ L: 0, a: 0, b: 0 }, { L: 1, a: 0, b: 0 }, AXIS_COLORS.L, "L");
  }

  function drawPoints() {
    const projected = scene.points
      .map((p) => ({ ...project(p.oklab), color: p.rgb }))
      .sort((a, b) => a.depth - b.depth);

    if (projected.length === 0) return;

    // Fade points by depth so the cloud reads as 3D (near = brighter/front).
    const minDepth = projected[0].depth;
    const range = projected[projected.length - 1].depth - minDepth || 1;

    for (const p of projected) {
      const nearness = (p.depth - minDepth) / range;
      ctx.globalAlpha = 0.4 + 0.6 * nearness;
      ctx.fillStyle = rgbCss(p.color);
      ctx.fillRect(p.sx, p.sy, 2.5, 2.5);
    }
    ctx.globalAlpha = 1;
  }

  function drawSpheres() {
    for (const sphere of scene.spheres) {
      const p = project(sphere.oklab);
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, sphere.radius * p.scale, 0, Math.PI * 2);
      ctx.fillStyle = "rgb(255 80 80 / 10%)";
      ctx.fill();
      ctx.strokeStyle = "rgb(255 80 80 / 35%)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function drawMarkers() {
    const projected = scene.markers
      .map((m) => ({ ...project(m.oklab), marker: m }))
      .sort((a, b) => a.depth - b.depth);

    for (const { sx, sy, marker } of projected) {
      const radius = marker.radius ?? 9;
      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      ctx.fillStyle = rgbCss(marker.rgb);
      ctx.fill();
      ctx.strokeStyle = "rgb(255 255 255 / 80%)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      if (marker.label != null) {
        const luma = 0.2126 * marker.rgb.r + 0.7152 * marker.rgb.g + 0.0722 * marker.rgb.b;
        ctx.fillStyle = luma < 140 ? "#fff" : "#000";
        ctx.font = "10px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(marker.label), sx, sy);
        ctx.textAlign = "start";
        ctx.textBaseline = "alphabetic";
      }
    }
  }

  function render() {
    frame = 0;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawAxes();
    if (scene.showPoints !== false) drawPoints();
    if (scene.showSpheres) drawSpheres();
    if (scene.showMarkers !== false) drawMarkers();
  }

  function scheduleRender() {
    if (frame) return;
    frame = requestAnimationFrame(render);
  }

  function setScene(next) {
    scene = { ...scene, ...next };
    scheduleRender();
  }

  // --- interaction ---
  // Left-drag orbits; right-drag or Shift-drag pans; wheel zooms; double-click
  // resets the view (handy when a cloud sits far up or down the L axis).
  let mode = null;
  let lastX = 0;
  let lastY = 0;
  let canvasScale = 1;

  canvas.addEventListener("pointerdown", (event) => {
    mode = event.button === 2 || event.shiftKey ? "pan" : "orbit";
    lastX = event.clientX;
    lastY = event.clientY;
    const rect = canvas.getBoundingClientRect();
    canvasScale = rect.width ? canvas.width / rect.width : 1;
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!mode) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    if (mode === "pan") {
      panX += dx * canvasScale;
      panY += dy * canvasScale;
    } else {
      yaw += dx * 0.01;
      pitch = Math.max(-1.4, Math.min(1.4, pitch + dy * 0.01));
    }
    lastX = event.clientX;
    lastY = event.clientY;
    scheduleRender();
  });

  canvas.addEventListener("pointerup", (event) => {
    mode = null;
    canvas.releasePointerCapture(event.pointerId);
  });

  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  canvas.addEventListener("dblclick", () => {
    yaw = DEFAULT_YAW;
    pitch = DEFAULT_PITCH;
    zoom = 1;
    panX = 0;
    panY = 0;
    scheduleRender();
  });

  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      zoom = Math.max(0.2, Math.min(12, zoom * (event.deltaY < 0 ? 1.15 : 0.87)));
      scheduleRender();
    },
    { passive: false },
  );

  return { setScene, render: scheduleRender };
}
