'use strict';

const STORAGE_KEY = 'battery-eta:samples-v1';
const MAX_SAMPLES = 200;
const REGRESSION_WINDOW_MINUTES = 180;

const els = {
  batteryFill: document.getElementById('batteryFill'),
  batteryPercent: document.getElementById('batteryPercent'),
  chargingState: document.getElementById('chargingState'),
  etaTime: document.getElementById('etaTime'),
  etaRemaining: document.getElementById('etaRemaining'),
  drainRate: document.getElementById('drainRate'),
  confidenceNote: document.getElementById('confidenceNote'),
  manualSection: document.getElementById('manualSection'),
  manualForm: document.getElementById('manualForm'),
  manualLevel: document.getElementById('manualLevel'),
  resetBtn: document.getElementById('resetBtn'),
  chart: document.getElementById('historyChart'),
  chartEmpty: document.getElementById('chartEmpty'),
};

let samples = loadSamples();
let lastCharging = null;

function loadSamples() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSamples() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(samples));
  } catch {
    // storage unavailable (private mode, quota) — degrade silently
  }
}

function addSample(levelPercent, charging) {
  const now = Date.now();
  const last = samples[samples.length - 1];

  // A charge cycle just ended (plugged -> unplugged): start a fresh discharge session
  // so old charging-period noise doesn't skew the slope.
  if (lastCharging === true && charging === false) {
    samples = [];
  }
  lastCharging = charging;

  // Avoid flooding identical consecutive readings.
  if (last && last.level === levelPercent && last.charging === charging && now - last.t < 30000) {
    return;
  }

  samples.push({ t: now, level: levelPercent, charging });
  if (samples.length > MAX_SAMPLES) {
    samples = samples.slice(samples.length - MAX_SAMPLES);
  }
  saveSamples();
  render();
}

function linearRegression(points) {
  // points: [{x: minutes, y: percent}]
  const n = points.length;
  if (n < 2) return null;

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denom; // % per minute
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function computeEstimate() {
  const discharging = samples.filter(s => !s.charging);
  if (discharging.length < 2) {
    return { status: 'insufficient' };
  }

  const cutoff = Date.now() - REGRESSION_WINDOW_MINUTES * 60000;
  const windowed = discharging.filter(s => s.t >= cutoff);
  const usable = windowed.length >= 2 ? windowed : discharging;

  const first = usable[0];
  const points = usable.map(s => ({ x: (s.t - first.t) / 60000, y: s.level }));
  const reg = linearRegression(points);
  if (!reg || reg.slope >= -0.0005) {
    return { status: 'stable' };
  }

  const currentLevel = samples[samples.length - 1].level;
  const remainingMinutes = currentLevel / Math.abs(reg.slope);
  const etaDate = new Date(Date.now() + remainingMinutes * 60000);

  return {
    status: 'ok',
    ratePerHour: Math.abs(reg.slope) * 60,
    remainingMinutes,
    etaDate,
    sampleCount: usable.length,
    spanMinutes: points[points.length - 1].x,
  };
}

function formatDuration(minutes) {
  if (!isFinite(minutes) || minutes < 0) return '—';
  const totalMin = Math.round(minutes);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m} min`;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

function formatTime(date) {
  return date.toLocaleString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    day: isSameDay(date, new Date()) ? undefined : '2-digit',
    month: isSameDay(date, new Date()) ? undefined : 'short',
  });
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function render() {
  const last = samples[samples.length - 1];
  if (!last) {
    els.batteryPercent.textContent = '--%';
    drawChart();
    return;
  }

  els.batteryPercent.textContent = `${Math.round(last.level)}%`;
  els.batteryFill.style.width = `${last.level}%`;
  els.batteryFill.style.background = last.level <= 20 ? 'var(--danger)' : last.level <= 50 ? 'var(--warn)' : 'var(--accent)';

  if (last.charging) {
    els.chargingState.textContent = '⚡ En charge — estimation de décharge en pause';
  } else {
    els.chargingState.textContent = 'Sur batterie';
  }

  const estimate = computeEstimate();

  if (last.charging) {
    els.etaTime.textContent = '—';
    els.etaRemaining.textContent = '—';
    els.drainRate.textContent = '—';
    els.confidenceNote.textContent = 'Débranche ton téléphone pour démarrer une nouvelle estimation de décharge.';
  } else if (estimate.status === 'insufficient') {
    els.etaTime.textContent = '—';
    els.etaRemaining.textContent = '—';
    els.drainRate.textContent = '—';
    els.confidenceNote.textContent = 'Pas encore assez de mesures pour estimer. Patiente un peu ou ajoute une mesure manuelle.';
  } else if (estimate.status === 'stable') {
    els.etaTime.textContent = 'Stable';
    els.etaRemaining.textContent = '—';
    els.drainRate.textContent = '~0%/h';
    els.confidenceNote.textContent = 'La batterie ne semble pas baisser pour le moment.';
  } else {
    els.etaTime.textContent = formatTime(estimate.etaDate);
    els.etaRemaining.textContent = formatDuration(estimate.remainingMinutes);
    els.drainRate.textContent = `${estimate.ratePerHour.toFixed(1)}%/h`;
    const span = estimate.spanMinutes < 1 ? '<1 min' : formatDuration(estimate.spanMinutes);
    els.confidenceNote.textContent = `Basé sur ${estimate.sampleCount} mesures sur ${span}. Plus tu utilises l'app, plus l'estimation devient précise.`;
  }

  drawChart();
}

function drawChart() {
  const canvas = els.chart;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600;
  const h = 220;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const discharging = samples.filter(s => !s.charging);
  if (discharging.length < 2) {
    els.chartEmpty.classList.remove('hidden');
    return;
  }
  els.chartEmpty.classList.add('hidden');

  const padding = 24;
  const first = discharging[0];
  const last = discharging[discharging.length - 1];
  const tSpan = Math.max(last.t - first.t, 1);

  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1;
  for (let pct = 0; pct <= 100; pct += 25) {
    const y = padding + (1 - pct / 100) * (h - padding * 2);
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(w - padding, y);
    ctx.stroke();
  }

  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = 2;
  ctx.beginPath();
  discharging.forEach((s, i) => {
    const x = padding + ((s.t - first.t) / tSpan) * (w - padding * 2);
    const y = padding + (1 - s.level / 100) * (h - padding * 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = '#22c55e';
  discharging.forEach(s => {
    const x = padding + ((s.t - first.t) / tSpan) * (w - padding * 2);
    const y = padding + (1 - s.level / 100) * (h - padding * 2);
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = '#94a3b8';
  ctx.font = '11px sans-serif';
  ctx.fillText('100%', 2, padding + 4);
  ctx.fillText('0%', 2, h - padding + 4);
}

function setupManualMode() {
  els.manualSection.classList.remove('hidden');
  els.manualForm.addEventListener('submit', e => {
    e.preventDefault();
    const value = Number(els.manualLevel.value);
    if (!Number.isFinite(value) || value < 0 || value > 100) return;
    addSample(value, false);
    els.manualLevel.value = '';
  });
}

function setupBatteryApi(battery) {
  const push = () => addSample(Math.round(battery.level * 100), battery.charging);
  push();
  battery.addEventListener('levelchange', push);
  battery.addEventListener('chargingchange', push);
  // Poll too: levelchange only fires on whole-percent steps on some platforms,
  // so a periodic tick keeps the regression window populated during long idle stretches.
  setInterval(push, 5 * 60000);
}

async function init() {
  if (samples.length) {
    lastCharging = samples[samples.length - 1].charging;
  }

  if ('getBattery' in navigator) {
    try {
      const battery = await navigator.getBattery();
      setupBatteryApi(battery);
    } catch {
      setupManualMode();
    }
  } else {
    setupManualMode();
  }

  els.resetBtn.addEventListener('click', () => {
    const keepLast = samples[samples.length - 1];
    samples = keepLast ? [keepLast] : [];
    saveSamples();
    render();
  });

  render();
  window.addEventListener('resize', drawChart);
}

init();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
