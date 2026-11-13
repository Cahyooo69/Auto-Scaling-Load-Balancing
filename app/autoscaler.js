const http = require('http');

const DOCKER_SOCKET =
  process.env.DOCKER_SOCKET ||
  (process.platform === 'win32' ? '\\\\.\\pipe\\docker_engine' : '/var/run/docker.sock');

const SERVICE_NAME = process.env.SERVICE_NAME || 'app';
const SWARM_SERVICE_NAME = process.env.SWARM_SERVICE_NAME || 'wartiket_app';
const COMPOSE_PROJECT = process.env.COMPOSE_PROJECT || 'auto-scaling-load-balancing-main';
const HEALTH_URL = process.env.HEALTH_URL || 'http://localhost/health';
const MIN_REPLICAS = parseInt(process.env.MIN_REPLICAS || '3', 10);
const MAX_REPLICAS = parseInt(process.env.MAX_REPLICAS || '8', 10);
const SCALE_STEP = parseInt(process.env.SCALE_STEP || '2', 10);
const SCALE_UP_CPU = parseFloat(process.env.SCALE_UP_CPU || '40');
const SCALE_DOWN_CPU = parseFloat(process.env.SCALE_DOWN_CPU || '15');
const SCALE_UP_LATENCY_MS = parseFloat(process.env.SCALE_UP_LATENCY_MS || '120');
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS || '1500', 10);
const COOLDOWN_MS = parseInt(process.env.COOLDOWN_MS || '6000', 10);
const DOWN_IDLE_TICKS = parseInt(process.env.DOWN_IDLE_TICKS || '16', 10);

function dockerRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        socketPath: DOCKER_SOCKET,
        path,
        method,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : undefined,
        timeout: 8000,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let parsed = raw;
          try {
            if (raw) parsed = JSON.parse(raw);
          } catch {}
          if (res.statusCode >= 400) {
            const msg = parsed?.message || raw || `HTTP ${res.statusCode}`;
            const err = new Error(`Docker API ${method} ${path} failed (${res.statusCode}): ${msg}`);
            err.statusCode = res.statusCode;
            return reject(err);
          }
          resolve({ statusCode: res.statusCode, data: parsed });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error(`Docker API timeout on ${method} ${path}`));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function calcQuotaCpuPct(stats, nanoCpus = 0) {
  const cpuTotal = Number(stats?.cpu_stats?.cpu_usage?.total_usage || 0);
  const preCpuTotal = Number(stats?.precpu_stats?.cpu_usage?.total_usage || 0);
  const sysTotal = Number(stats?.cpu_stats?.system_cpu_usage || 0);
  const preSysTotal = Number(stats?.precpu_stats?.system_cpu_usage || 0);
  const onlineCpus =
    Number(stats?.cpu_stats?.online_cpus) ||
    stats?.cpu_stats?.cpu_usage?.percpu_usage?.length ||
    1;

  const cpuDelta = cpuTotal - preCpuTotal;
  const systemDelta = sysTotal - preSysTotal;
  if (cpuDelta <= 0 || systemDelta <= 0) return 0;

  const rawPct = (cpuDelta / systemDelta) * onlineCpus * 100;
  const quotaCores = nanoCpus > 0 ? nanoCpus / 1e9 : onlineCpus;
  return Number(((rawPct / (quotaCores * 100)) * 100).toFixed(1));
}

function decideScaleAction({
  replicas,
  minReplicas = MIN_REPLICAS,
  maxReplicas = MAX_REPLICAS,
  scaleStep = SCALE_STEP,
  avgCpuPct = 0,
  peakCpuPct = 0,
  healthOk = true,
  healthMs = 0,
  demandBoost = false,
  highStreak = 0,
  lowStreak = 0,
  nowMs = Date.now(),
  lastScaleUpAt = 0,
  scaleUpCpu = SCALE_UP_CPU,
  scaleDownCpu = SCALE_DOWN_CPU,
  scaleUpLatencyMs = SCALE_UP_LATENCY_MS,
  cooldownMs = COOLDOWN_MS,
  downIdleTicks = DOWN_IDLE_TICKS,
}) {
  const highSignal =
    avgCpuPct >= scaleUpCpu ||
    peakCpuPct >= scaleUpCpu + 20 ||
    healthMs >= scaleUpLatencyMs ||
    !healthOk ||
    demandBoost;

  const idleSignal = avgCpuPct < scaleDownCpu && healthMs < 80 && healthOk && !demandBoost;

  if (highSignal) {
    const nextHigh = highStreak + 1;
    if (replicas < maxReplicas && nowMs - lastScaleUpAt >= cooldownMs) {
      return {
        target: Math.min(maxReplicas, replicas + scaleStep),
        reason: demandBoost
          ? 'traffic burst'
          : !healthOk
          ? 'health degradation'
          : healthMs >= scaleUpLatencyMs
          ? `latency ${healthMs}ms`
          : `CPU ${avgCpuPct.toFixed(1)}% (peak ${peakCpuPct.toFixed(1)}%)`,
        highStreak: 0,
        lowStreak: 0,
      };
    }
    return { target: null, reason: '', highStreak: nextHigh, lowStreak: 0 };
  }

  if (idleSignal) {
    const nextLow = lowStreak + 1;
    if (replicas > minReplicas && nextLow >= downIdleTicks) {
      return {
        target: Math.max(minReplicas, replicas - scaleStep),
        reason: `idle CPU ${avgCpuPct.toFixed(1)}%`,
        highStreak: 0,
        lowStreak: 0,
      };
    }
    return { target: null, reason: '', highStreak: 0, lowStreak: nextLow };
  }

  return { target: null, reason: '', highStreak: 0, lowStreak: 0 };
}

function buildReplicaConfig(tpl, containerNumber, serviceName = SERVICE_NAME) {
  const labels = { ...(tpl?.Config?.Labels || {}) };
  delete labels['com.docker.compose.replace'];
  labels['com.docker.compose.container-number'] = String(containerNumber);
  labels['wartiket.autoscaled'] = 'true';

  const endpoints = {};
  for (const netName of Object.keys(tpl?.NetworkSettings?.Networks || {})) {
    endpoints[netName] = { Aliases: [serviceName] };
  }

  return {
    Image: tpl.Config.Image,
    Env: tpl.Config.Env,
    Cmd: tpl.Config.Cmd,
    Entrypoint: tpl.Config.Entrypoint,
    WorkingDir: tpl.Config.WorkingDir,
    ExposedPorts: tpl.Config.ExposedPorts,
    Healthcheck: tpl.Config.Healthcheck,
    Labels: labels,
    HostConfig: {
      NetworkMode: tpl.HostConfig.NetworkMode,
      RestartPolicy: tpl.HostConfig.RestartPolicy || { Name: 'unless-stopped' },
      LogConfig: tpl.HostConfig.LogConfig,
      NanoCpus: tpl.HostConfig.NanoCpus || 250000000,
      Memory: tpl.HostConfig.Memory || 268435456,
      MemoryReservation: tpl.HostConfig.MemoryReservation || 67108864,
      MemorySwap: tpl.HostConfig.MemorySwap || 536870912,
    },
    NetworkingConfig: { EndpointsConfig: endpoints },
  };
}

async function listComposeAppContainers(all = false) {
  const filters = encodeURIComponent(
    JSON.stringify({ label: [`com.docker.compose.service=${SERVICE_NAME}`] })
  );
  const { data } = await dockerRequest('GET', `/containers/json?all=${all ? 1 : 0}&filters=${filters}`);
  const rows = Array.isArray(data) ? data : [];
  const preferred = rows.filter(
    (c) => (c.Labels?.['com.docker.compose.project'] || '') === COMPOSE_PROJECT
  );
  return preferred.length > 0 ? preferred : rows;
}

async function getSwarmService() {
  try {
    const { data } = await dockerRequest('GET', `/services/${encodeURIComponent(SWARM_SERVICE_NAME)}`);
    return data;
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 503) return null;
    throw err;
  }
}

async function measureContainers(containers) {
  if (!containers.length) return { avgCpu: 0, peakCpu: 0, avgMem: 0 };
  const samples = await Promise.all(
    containers.map(async (c) => {
      try {
        const [{ data: inspect }, { data: stats }] = await Promise.all([
          dockerRequest('GET', `/containers/${c.Id}/json`),
          dockerRequest('GET', `/containers/${c.Id}/stats?stream=false`),
        ]);
        const cpu = calcQuotaCpuPct(stats, inspect?.HostConfig?.NanoCpus || 250000000);
        const memUsage = Number(stats?.memory_stats?.usage || 0);
        const memLimit = Number(stats?.memory_stats?.limit || 1);
        return { cpu, mem: (memUsage / memLimit) * 100 };
      } catch {
        return { cpu: 0, mem: 0 };
      }
    })
  );
  const cpuSum = samples.reduce((acc, s) => acc + s.cpu, 0);
  const peakCpu = samples.reduce((acc, s) => Math.max(acc, s.cpu), 0);
  const memSum = samples.reduce((acc, s) => acc + s.mem, 0);
  return {
    avgCpu: cpuSum / samples.length,
    peakCpu,
    avgMem: memSum / samples.length,
  };
}

async function scaleComposeReplicas(target) {
  const allContainers = await listComposeAppContainers(true);
  const running = allContainers.filter((c) => c.State === 'running');
  if (running.length === target) return;

  if (target > running.length) {
    const templateTarget = running[0];
    if (!templateTarget) return;
    const { data: tpl } = await dockerRequest('GET', `/containers/${templateTarget.Id}/json`);
    const project = tpl?.Config?.Labels?.['com.docker.compose.project'] || COMPOSE_PROJECT;
    const usedNums = new Set(
      allContainers
        .map((c) => parseInt(c.Labels?.['com.docker.compose.container-number'] || '0', 10))
        .filter((n) => n > 0)
    );

    const toAdd = target - running.length;
    for (let i = 0; i < toAdd; i++) {
      let num = 1;
      while (usedNums.has(num)) num++;
      usedNums.add(num);

      const name = `${project}-${SERVICE_NAME}-${num}`;
      const stale = allContainers.find((c) => (c.Names || []).includes(`/${name}`) && c.State !== 'running');
      if (stale) {
        await dockerRequest('DELETE', `/containers/${stale.Id}?force=true`).catch(() => {});
      }
      const cfg = buildReplicaConfig(tpl, num, SERVICE_NAME);
      const { data: created } = await dockerRequest(
        'POST',
        `/containers/create?name=${encodeURIComponent(name)}`,
        cfg
      );
      await dockerRequest('POST', `/containers/${created.Id}/start`);
      console.log(`>>> [AUTO-SCALE UP] Started ${name} (${created.Id.slice(0, 12)})`);
    }
    return;
  }

  const removable = [...running]
    .sort((a, b) => {
      const na = parseInt(a.Labels?.['com.docker.compose.container-number'] || '0', 10);
      const nb = parseInt(b.Labels?.['com.docker.compose.container-number'] || '0', 10);
      return nb - na;
    })
    .filter((c) => parseInt(c.Labels?.['com.docker.compose.container-number'] || '0', 10) > MIN_REPLICAS);

  const toRemove = Math.min(running.length - target, removable.length);
  for (let i = 0; i < toRemove; i++) {
    const targetC = removable[i];
    const cName = (targetC.Names?.[0] || targetC.Id.slice(0, 12)).replace(/^\//, '');
    await dockerRequest('POST', `/containers/${targetC.Id}/stop?t=3`).catch(() => {});
    await dockerRequest('DELETE', `/containers/${targetC.Id}?force=true`).catch(() => {});
    console.log(`>>> [AUTO-SCALE DOWN] Removed ${cName}`);
  }
}

async function scaleSwarmService(svc, target) {
  const spec = { ...svc.Spec, Mode: { Replicated: { Replicas: target } } };
  await dockerRequest(
    'POST',
    `/services/${svc.ID}/update?version=${svc.Version.Index}`,
    spec
  );
  console.log(`>>> [AUTO-SCALE SWARM] Scaled ${SWARM_SERVICE_NAME} -> ${target} replicas`);
}

async function probeHealthLatency() {
  const t0 = performance.now();
  const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(3000) });
  await res.text();
  return { ok: res.ok, ms: Math.round(performance.now() - t0) };
}

function createDemandReader() {
  if (!process.env.REDIS_HOST) return async () => false;
  try {
    const Redis = require('ioredis');
    const r = new Redis({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      commandTimeout: 2000,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    r.on('error', () => {});
    r.connect().catch(() => {});
    return async () => {
      try {
        const val = await r.get('autoscaler:demand');
        return Number(val) > 0;
      } catch {
        return false;
      }
    };
  } catch {
    return async () => false;
  }
}

async function startAutoscaler({ runOnce = process.argv.includes('--once') } = {}) {
  const hasDemand = createDemandReader();
  let highStreak = 0;
  let lowStreak = 0;
  let lastScaleUpAt = 0;

  async function tick() {
    try {
      const swarmSvc = await getSwarmService();
      const composeContainers = swarmSvc
        ? await (async () => {
            const { data } = await dockerRequest('GET', '/containers/json');
            return (data || []).filter((c) => (c.Names?.[0] || '').includes(SWARM_SERVICE_NAME));
          })()
        : await listComposeAppContainers(false);

      const replicas = swarmSvc
        ? Number(swarmSvc.Spec?.Mode?.Replicated?.Replicas || MIN_REPLICAS)
        : composeContainers.length;

      const [stats, health, demandBoost] = await Promise.all([
        measureContainers(composeContainers),
        probeHealthLatency().catch(() => ({ ok: false, ms: 9999 })),
        hasDemand(),
      ]);

      const ts = new Date().toTimeString().slice(0, 8);
      const mode = swarmSvc ? 'Swarm' : 'Compose';
      console.log(
        `[${ts}] [${mode}] Replicas=${replicas} | QuotaCPU=${stats.avgCpu.toFixed(1)}% (peak ${stats.peakCpu.toFixed(1)}%) | Mem=${stats.avgMem.toFixed(1)}% | Health=${health.ms}ms | Demand=${demandBoost}`
      );

      const nowMs = Date.now();
      const decision = decideScaleAction({
        replicas,
        avgCpuPct: stats.avgCpu,
        peakCpuPct: stats.peakCpu,
        healthOk: health.ok,
        healthMs: health.ms,
        demandBoost,
        highStreak,
        lowStreak,
        nowMs,
        lastScaleUpAt,
      });

      highStreak = decision.highStreak;
      lowStreak = decision.lowStreak;

      if (decision.target !== null && decision.target !== replicas) {
        const isUp = decision.target > replicas;
        console.log(
          `>>> [AUTO-SCALE] ${mode} ${replicas} -> ${decision.target} (${decision.reason})`
        );
        if (swarmSvc) {
          await scaleSwarmService(swarmSvc, decision.target);
        } else {
          await scaleComposeReplicas(decision.target);
        }
        if (isUp) lastScaleUpAt = nowMs;
      }
    } catch (err) {
      console.error(`[AUTO-SCALER ERROR] ${err.message}`);
    }
  }

  console.log(
    `TiketWar Auto-Scaler started [${MIN_REPLICAS}..${MAX_REPLICAS} replicas, scale-up >=${SCALE_UP_CPU}% quota CPU / >=${SCALE_UP_LATENCY_MS}ms]`
  );
  // Warm up DNS/TCP keep-alive once so cold startup latency does not trigger spurious scale-up
  await probeHealthLatency().catch(() => {});
  await tick();
  if (!runOnce) {
    let busy = false;
    setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        await tick();
      } finally {
        busy = false;
      }
    }, INTERVAL_MS);
  }
}

if (require.main === module) {
  startAutoscaler();
}

module.exports = {
  calcQuotaCpuPct,
  decideScaleAction,
  buildReplicaConfig,
  startAutoscaler,
};
