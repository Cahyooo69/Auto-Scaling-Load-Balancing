/**
 * Lightweight Docker Swarm Auto-Scaler for `wartiket_app`
 * Monitors container CPU% (via `docker stats`) and `/health` latency every 3s.
 * Automatically scales `wartiket_app` between MIN_REPLICAS (2) and MAX_REPLICAS (8).
 *
 * Run: node scripts/swarm-autoscaler.mjs [--once]
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SERVICE_NAME = process.env.SERVICE_NAME || 'wartiket_app';
const HEALTH_URL = process.env.HEALTH_URL || 'http://localhost/health';
const MIN_REPLICAS = parseInt(process.env.MIN_REPLICAS || '2', 10);
const MAX_REPLICAS = parseInt(process.env.MAX_REPLICAS || '8', 10);
const SCALE_UP_CPU = parseFloat(process.env.SCALE_UP_CPU || '60');
const SCALE_DOWN_CPU = parseFloat(process.env.SCALE_DOWN_CPU || '20');
const SCALE_UP_LATENCY_MS = parseFloat(process.env.SCALE_UP_LATENCY_MS || '150');
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS || '3000', 10);
const RUN_ONCE = process.argv.includes('--once');

let highStreak = 0;
let lowStreak = 0;

async function getCurrentReplicas() {
  const { stdout } = await execFileAsync('docker', [
    'service',
    'inspect',
    SERVICE_NAME,
    '--format',
    '{{.Spec.Mode.Replicated.Replicas}}',
  ]);
  return parseInt(stdout.trim(), 10) || MIN_REPLICAS;
}

async function getAvgAppStats() {
  const { stdout } = await execFileAsync('docker', [
    'stats',
    '--no-stream',
    '--format',
    '{{.Name}}|{{.CPUPerc}}|{{.MemPerc}}',
  ]);
  const rows = stdout
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.startsWith(SERVICE_NAME));

  if (rows.length === 0) return { containers: 0, avgCpu: 0, avgMem: 0 };

  let cpuSum = 0;
  let memSum = 0;
  for (const row of rows) {
    const [, cpuStr = '0%', memStr = '0%'] = row.split('|');
    cpuSum += parseFloat(cpuStr.replace('%', '')) || 0;
    memSum += parseFloat(memStr.replace('%', '')) || 0;
  }
  return {
    containers: rows.length,
    avgCpu: cpuSum / rows.length,
    avgMem: memSum / rows.length,
  };
}

async function probeHealthLatency() {
  const t0 = performance.now();
  const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(3000) });
  await res.text();
  return { ok: res.ok, ms: Math.round(performance.now() - t0) };
}

async function scaleService(target) {
  console.log(`>>> [AUTO-SCALE] Scaling ${SERVICE_NAME} -> ${target} replicas...`);
  await execFileAsync('docker', ['service', 'scale', `${SERVICE_NAME}=${target}`]);
}

async function tick() {
  try {
    const [replicas, stats, health] = await Promise.all([
      getCurrentReplicas(),
      getAvgAppStats(),
      probeHealthLatency().catch(() => ({ ok: false, ms: 9999 })),
    ]);

    const ts = new Date().toTimeString().slice(0, 8);
    console.log(
      `[${ts}] Replicas=${replicas} (running=${stats.containers}) | CPU=${stats.avgCpu.toFixed(1)}% | Mem=${stats.avgMem.toFixed(1)}% | Health=${health.ms}ms`
    );

    const needsScaleUp = stats.avgCpu >= SCALE_UP_CPU || health.ms >= SCALE_UP_LATENCY_MS || !health.ok;
    const canScaleDown = stats.avgCpu < SCALE_DOWN_CPU && health.ms < 80 && health.ok;

    if (needsScaleUp) {
      highStreak += 1;
      lowStreak = 0;
      if (highStreak >= 2 && replicas < MAX_REPLICAS) {
        const next = Math.min(MAX_REPLICAS, replicas + 2);
        await scaleService(next);
        highStreak = 0;
      }
    } else if (canScaleDown) {
      lowStreak += 1;
      highStreak = 0;
      if (lowStreak >= 3 && replicas > MIN_REPLICAS) {
        const next = Math.max(MIN_REPLICAS, replicas - 2);
        await scaleService(next);
        lowStreak = 0;
      }
    } else {
      highStreak = 0;
      lowStreak = 0;
    }
  } catch (err) {
    console.error(`[AUTO-SCALER ERROR] ${err.message}`);
  }
}

async function main() {
  console.log(`Docker Swarm Auto-Scaler started for ${SERVICE_NAME} [${MIN_REPLICAS}..${MAX_REPLICAS} replicas]`);
  await tick();
  if (!RUN_ONCE) {
    setInterval(tick, INTERVAL_MS);
  }
}

main();

