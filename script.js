const $ = (selector) => document.querySelector(selector);

const canvas = $('#c');
const ctx = canvas.getContext('2d');

const W = 22;
const WB = 2.6;
const CL = 4.4;
const CW = 1.9;
const REAR = 0.9;
const MAXS = 35 * Math.PI / 180;
const LOCK = 450;
const GAP = 7;
const CURB = 14.9;

let started = false;
let tEnd = 0;
let S = 0;
let H = 0;
let dpr = 1;
let car;
let park;
let gapTop;
let wheel = 0;
let recenter = false;
let gear = 'N';
let pd;
let press;
let hits = 0;
let t0 = null;
let done = false;
let hold = 0;
let cool = 0;
let flash = 0;
let toastT = 0;
let last = 0;
let bestTime = Number(localStorage.getItem('creneau-best-time') || 0);

const gearButtons = [...document.querySelectorAll('#gears button')];
const wheelEl = $('#wheel');
const helpText = `
  1. Si vous êtes à l'arrêt, passez en R avant de reculer.
  2. Tournez le volant pour entrer dans la place.
  3. Quand le véhicule est bien aligné, passez en 1 et avancez doucement.
  4. Restez à moins de 0.9 m du trottoir et sans contact.
`;

function fmt(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function say(message) {
  const el = $('#toast');
  const span = el.querySelector('span');
  span.textContent = message;
  el.classList.add('show');
  toastT = 1.4;
}

function setGear(nextGear) {
  gear = nextGear;
  gearButtons.forEach((button) => {
    button.classList.toggle('on', button.dataset.g === nextGear);
  });
}

function resize() {
  dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentNode.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  S = rect.width / W;
  H = rect.height / S;
  reset();
}

function reset() {
  gapTop = H * 0.42;
  const b = gapTop + GAP;

  park = [
    { x0: 12.3, x1: 14.2, y0: gapTop - CL, y1: gapTop, col: '#7d8a96' },
    { x0: 12.3, x1: 14.2, y0: b, y1: b + CL, col: '#8a7a63' }
  ];

  car = { x: 10.4, y: gapTop - REAR, a: 0, v: 0 };
  wheel = 0;
  gear = 'N';
  pd = { c: 0, b: 0, a: 0 };
  press = { c: 0, b: 0, a: 0 };
  hits = 0;
  t0 = null;
  done = false;
  hold = 0;
  cool = 0;
  flash = 0;
  setGear('N');
}

function updateStats() {
  const elapsed = t0 ? ((done ? tEnd : performance.now()) - t0) / 1000 : 0;
  const text = `Contacts ${hits} · ${fmt(elapsed)}`;
  $('#stats').textContent = text;
}

function poly(carState) {
  const f = [Math.sin(carState.a), -Math.cos(carState.a)];
  const r = [Math.cos(carState.a), Math.sin(carState.a)];
  const m = CL / 2 - REAR;
  const cx = carState.x + f[0] * m;
  const cy = carState.y + f[1] * m;

  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([ax, by]) => [
    cx + r[0] * ax * CW / 2 + f[0] * by * CL / 2,
    cy + r[1] * ax * CW / 2 + f[1] * by * CL / 2
  ]);
}

function rect(p) {
  return [[p.x0, p.y0], [p.x1, p.y0], [p.x1, p.y1], [p.x0, p.y1]];
}

function sat(A, B) {
  for (const P of [A, B]) {
    for (let i = 0; i < 4; i += 1) {
      const p = P[i];
      const q = P[(i + 1) % 4];
      const nx = p[1] - q[1];
      const ny = q[0] - p[0];
      let a0 = 1e9;
      let a1 = -1e9;
      let b0 = 1e9;
      let b1 = -1e9;

      for (const v of A) {
        const d = v[0] * nx + v[1] * ny;
        a0 = Math.min(a0, d);
        a1 = Math.max(a1, d);
      }

      for (const v of B) {
        const d = v[0] * nx + v[1] * ny;
        b0 = Math.min(b0, d);
        b1 = Math.max(b1, d);
      }

      if (a1 < b0 || b1 < a0) return false;
    }
  }

  return true;
}

function step(dt) {
  const rate = { c: [4, 1.7], b: [6, 6], a: [4, 5] };

  for (const key in pd) {
    pd[key] = Math.max(0, Math.min(1, pd[key] + (press[key] ? rate[key][0] : -rate[key][1]) * dt));
  }

  if (recenter) {
    const d = 400 * dt;
    wheel = Math.abs(wheel) < d ? 0 : wheel - Math.sign(wheel) * d;
    if (!wheel) recenter = false;
  }

  if (done) return;

  const dir = gear === 'R' ? -1 : gear === '1' ? 1 : 0;
  const eng = dir ? Math.max(0, Math.min(1, 1 - pd.c * 1.25)) : 0;

  if (eng > 0) {
    car.v += (dir * (0.9 + 4.2 * pd.a) - car.v) * Math.min(1, 2.2 * eng * dt);
  } else {
    car.v -= car.v * Math.min(1, 0.35 * dt);
  }

  const bk = 7 * pd.b * dt;
  car.v = Math.abs(car.v) <= bk ? 0 : car.v - Math.sign(car.v) * bk;

  if (Math.abs(car.v) < 0.02 && !eng) car.v = 0;
  if (car.v && t0 === null) t0 = performance.now();

  const steering = wheel / LOCK * MAXS;
  const previous = { x: car.x, y: car.y, a: car.a };

  car.x += car.v * Math.sin(car.a) * dt;
  car.y -= car.v * Math.cos(car.a) * dt;
  car.a += car.v / WB * Math.tan(steering) * dt;

  const P = poly(car);
  let hit = 0;
  let wall = 0;

  if (P.some((point) => point[0] > CURB)) hit = 1;

  for (const k of park) {
    if (sat(P, rect(k))) hit = 1;
  }

  if (P.some((point) => point[0] < 0.3 || point[1] < 0 || point[1] > H)) wall = 1;

  if (hit || wall) {
    car.x = previous.x;
    car.y = previous.y;
    car.a = previous.a;
    car.v = 0;

    if (hit && cool <= 0) {
      hits += 1;
      flash = 0.5;
      cool = 0.8;
      say('Contact !');
    }
  }

  cool -= dt;
  flash -= dt;

  const Q = poly(car);
  const b = gapTop + GAP;
  const mx = Math.max(...Q.map((point) => point[0]));
  const dist = CURB - mx;
  const inY = Q.every((point) => point[1] > gapTop + 0.15 && point[1] < b - 0.15);
  const ok = inY && Math.abs(Math.sin(car.a)) < 0.1 && dist <= 0.9 && mx <= CURB && Math.abs(car.v) < 0.05;
  hold = ok ? hold + dt : 0;

  if (hold > 0.7) {
    done = true;
    tEnd = performance.now();
    const elapsed = (tEnd - t0) / 1000;
    const best = bestTime === 0 || elapsed < bestTime;

    if (best) {
      bestTime = elapsed;
      localStorage.setItem('creneau-best-time', String(bestTime));
    }

    $('#msg h2').textContent = hits ? `Garé, avec ${hits} contact${hits > 1 ? 's' : ''}` : 'Réussi !';
    $('#msg p').textContent = `Temps ${fmt(elapsed)} · ${best ? 'Nouveau record !' : 'Record : ' + fmt(bestTime)} · à ${Math.max(0, Math.round(dist * 100))} cm de la bordure.`;
    $('#msg').hidden = false;
  }
}

function drawCar(x, y, a, col, steer, live) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);

  ctx.fillStyle = '#111';
  for (const [wx, wy, r] of [[-1, 0, 0], [1, 0, 0], [-1, -WB, steer], [1, -WB, steer]]) {
    ctx.save();
    ctx.translate(wx * (CW / 2 - 0.02), wy);
    ctx.rotate(r);
    ctx.fillRect(-0.13, -0.32, 0.26, 0.64);
    ctx.restore();
  }

  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.roundRect(-CW / 2, -(CL - REAR), CW, CL, 0.42);
  ctx.fill();

  ctx.fillStyle = '#0008';
  ctx.beginPath();
  ctx.roundRect(-CW / 2 + 0.18, -3.0, CW - 0.36, 0.75, 0.2);
  ctx.fill();

  ctx.fillStyle = '#0006';
  ctx.beginPath();
  ctx.roundRect(-CW / 2 + 0.2, -0.25, CW - 0.4, 0.5, 0.2);
  ctx.fill();

  ctx.fillStyle = '#0003';
  ctx.fillRect(-CW / 2 + 0.2, -2.25, CW - 0.4, 2);

  ctx.fillStyle = '#fff8d0';
  ctx.fillRect(-CW / 2 + 0.1, -(CL - REAR) + 0.05, 0.4, 0.16);
  ctx.fillRect(CW / 2 - 0.5, -(CL - REAR) + 0.05, 0.4, 0.16);

  const brakeLight = live && pd.b > 0.1;
  ctx.fillStyle = brakeLight ? '#ff2a1f' : '#7a1f1c';
  ctx.fillRect(-CW / 2 + 0.08, REAR - 0.2, 0.45, 0.14);
  ctx.fillRect(CW / 2 - 0.53, REAR - 0.2, 0.45, 0.14);

  if (live && gear === 'R') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(-0.2, REAR - 0.2, 0.4, 0.12);
  }

  ctx.restore();
}

function draw() {
  ctx.setTransform(dpr * S, 0, 0, dpr * S, 0, 0);

  ctx.fillStyle = '#2a2e35';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#8f949a';
  ctx.fillRect(CURB, 0, W - CURB, H);

  ctx.strokeStyle = '#0002';
  ctx.lineWidth = 0.05;
  for (let y = 0; y < H; y += 1.6) {
    ctx.beginPath();
    ctx.moveTo(CURB, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  ctx.fillStyle = '#c9c6ba';
  ctx.fillRect(CURB, 0, 0.18, H);

  ctx.strokeStyle = '#e9e6da88';
  ctx.lineWidth = 0.12;
  ctx.setLineDash([2, 2.4]);
  ctx.beginPath();
  ctx.moveTo(5, 0);
  ctx.lineTo(5, H);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(0.3, 0);
  ctx.lineTo(0.3, H);
  ctx.stroke();

  const b = gapTop + GAP;
  ctx.strokeStyle = done ? '#5fd08a' : '#e9e6dacc';
  ctx.lineWidth = 0.08;
  ctx.setLineDash([0.5, 0.4]);
  ctx.strokeRect(12.1, gapTop, CURB - 12.1, GAP);
  ctx.setLineDash([]);

  if (done) {
    ctx.fillStyle = '#5fd08a33';
    ctx.fillRect(12.1, gapTop, CURB - 12.1, GAP);
  }

  for (const k of park) {
    drawCar(13.25, k.y1 - REAR, 0, k.col, 0, false);
  }

  drawCar(car.x, car.y, car.a, '#f2c230', wheel / LOCK * MAXS, true);

  if (flash > 0) {
    const P = poly(car);
    ctx.strokeStyle = '#ff5a4d';
    ctx.lineWidth = 0.18;
    ctx.beginPath();
    P.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point[0], point[1]);
      else ctx.lineTo(point[0], point[1]);
    });
    ctx.closePath();
    ctx.stroke();
  }
}

function frame(timestamp) {
  const dt = Math.min(0.05, (timestamp - last) / 1000 || 0);
  last = timestamp;

  if (started) step(dt);

  if (toastT > 0 && (toastT -= dt) <= 0) {
    $('#toast').classList.remove('show');
  }

  draw();
  wheelEl.style.transform = `rotate(${wheel}deg)`;

  for (const key of 'cba') {
    const pedal = document.querySelector(`#p${key}`);
    pedal.style.setProperty('--v', pd[key]);
  }

  updateStats();
  requestAnimationFrame(frame);
}

function beginGame() {
  reset();
  $('#msg').hidden = true;
  started = true;
  $('#again').textContent = 'Rejouer';
  say('C’est parti !');
}

function bindGearButtons() {
  gearButtons.forEach((button) => {
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (pd.c < 0.6) {
        say("Enfoncez l'embrayage à fond");
        return;
      }
      setGear(button.dataset.g);
    });
  });
}

function bindWheel() {
  let pointerId = null;
  let lastAngle = 0;

  const getAngle = (event) => {
    const rect = wheelEl.getBoundingClientRect();
    return Math.atan2(event.clientY - (rect.top + rect.height / 2), event.clientX - (rect.left + rect.width / 2));
  };

  wheelEl.addEventListener('pointerdown', (event) => {
    pointerId = event.pointerId;
    wheelEl.setPointerCapture(pointerId);
    lastAngle = getAngle(event);
    recenter = false;
  });

  wheelEl.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointerId) return;
    const angle = getAngle(event);
    let delta = angle - lastAngle;
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    lastAngle = angle;
    wheel = Math.max(-LOCK, Math.min(LOCK, wheel + delta * 180 / Math.PI));
  });

  ['pointerup', 'pointercancel'].forEach((type) => {
    wheelEl.addEventListener(type, () => {
      pointerId = null;
    });
  });
}

function bindPedals() {
  document.querySelectorAll('.pedal').forEach((el) => {
    const key = el.dataset.k;
    el.addEventListener('pointerdown', (event) => {
      el.setPointerCapture(event.pointerId);
      press[key] = 1;
    });

    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((type) => {
      el.addEventListener(type, () => {
        press[key] = 0;
      });
    });
  });
}

function bindKeyboard() {
  const actions = {
    ArrowLeft: () => { wheel = Math.max(-LOCK, wheel - 40); },
    ArrowRight: () => { wheel = Math.min(LOCK, wheel + 40); },
    ArrowUp: () => { press.a = 1; },
    ArrowDown: () => { press.b = 1; },
    c: () => { press.c = 1; },
    C: () => { press.c = 1; },
    x: () => { press.b = 1; },
    X: () => { press.b = 1; },
    s: () => { press.a = 1; },
    S: () => { press.a = 1; },
  };

  document.addEventListener('keydown', (event) => {
    const key = event.key;
    if (key in actions) {
      event.preventDefault();
      actions[key]();
    }
    if (key === ' ') {
      event.preventDefault();
      press.c = 1;
    }
  });

  document.addEventListener('keyup', (event) => {
    const key = event.key;
    if (key === 'ArrowUp' || key === 's' || key === 'S') press.a = 0;
    if (key === 'ArrowDown' || key === 'x' || key === 'X') press.b = 0;
    if (key === ' ' || key === 'c' || key === 'C') press.c = 0;
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      recenter = false;
    }
  });
}

function bindGlobalControls() {
  $('#again').addEventListener('click', beginGame);
  $('#center').addEventListener('pointerdown', () => { recenter = true; });
  $('#helpBtn').addEventListener('click', () => {
    say('Aide');
    $('#msg h2').textContent = 'Aide rapide';
    $('#msg p').textContent = helpText.trim();
    $('#msg').hidden = false;
  });

  ['gesturestart', 'contextmenu'].forEach((type) => {
    document.addEventListener(type, (event) => event.preventDefault());
  });

  document.addEventListener('touchmove', (event) => event.preventDefault(), { passive: false });
}

bindGearButtons();
bindWheel();
bindPedals();
bindGlobalControls();
bindKeyboard();

window.addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);

$('#again').textContent = 'Commencer';
$('#msg').hidden = false;
started = false;
