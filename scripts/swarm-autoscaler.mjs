/**
 * Lightweight Docker Swarm & Compose Auto-Scaler entrypoint.
 * Delegates to shared implementation in app/autoscaler.js.
 *
 * Run: node scripts/swarm-autoscaler.mjs [--once]
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { startAutoscaler } = require('../app/autoscaler.js');

startAutoscaler();
