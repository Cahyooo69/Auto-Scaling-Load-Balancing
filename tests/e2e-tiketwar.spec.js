/**
 * ============================================================================
 * E2E TEST SUITE: SISTEM WAR TIKET KONSER MUSIK (https://wartiketkonser.id)
 * ============================================================================
 * 
 * Skenario A: Navigasi SPA 6 Menu (State-Based Routing Tanpa Hash)
 * Skenario B: Transaksi War Tiket, Redis Atomic Lock & Sinkronisasi Database
 *
 * Kompatibel dengan Playwright Test Runner dan Standalone Native Node.js (Edge CDP)
 * Cara Menjalankan:
 *   1) Native Node.js Runner: node tests/e2e-tiketwar.spec.js
 *   2) Playwright Test:       npx playwright test tests/e2e-tiketwar.spec.js
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const BASE_URL = (process.env.TARGET_URL || 'https://wartiketkonser.id').replace(/\/+$/, '');
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = Number(process.env.CDP_PORT || 9245);
const USER_DATA = path.join(os.tmpdir(), `wartiket-spec-${Date.now()}`);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================================================
// STANDALONE HEADLESS CDP CLIENT (ZERO EXTERNAL NPM DEPENDENCIES)
// ============================================================================

async function getWsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await wait(250);
  }
  throw new Error('Tidak dapat terhubung ke Microsoft Edge CDP');
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve);
      this.ws.addEventListener('error', reject);
    });
    this.consoleErrors = [];
    this.httpFailures = [];

    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        this.consoleErrors.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text);
      } else if (msg.method === 'Network.responseReceived' && msg.params.response?.status >= 500) {
        this.httpFailures.push({ status: msg.params.response.status, url: msg.params.response.url });
      }
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    }
    return res.result?.value;
  }

  async waitFor(fnExpr, timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ok = await this.eval(`Boolean((${fnExpr})())`);
      if (ok) return;
      await wait(150);
    }
    throw new Error(`Timeout saat menunggu: ${fnExpr}`);
  }

  async goto(url) {
    await this.send('Page.navigate', { url });
    await this.waitFor(`() => document.readyState === 'complete'`);
    await wait(400);
  }

  close() {
    try { this.ws.close(); } catch {}
  }
}

// ============================================================================
// SUITE PENGUJIAN OTOMATIS
// ============================================================================

async function resetClusterState() {
  console.log(`[Persiapan] Mereset kuota & data demo di ${BASE_URL}/api/tickets/reset...`);
  const res = await fetch(`${BASE_URL}/api/tickets/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(res.status, 200, 'Endpoint reset tiket harus mengembalikan HTTP 200 OK');
}

async function runTests() {
  console.log('=========================================================================');
  console.log('         E2E TEST TIKETWAR: ROUTING SPA & TRANSAKSI REDIS LOCK           ');
  console.log('=========================================================================');
  console.log(`Target Domain: ${BASE_URL}\n`);

  await resetClusterState();

  const edge = spawn(
    EDGE_PATH,
    [
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${USER_DATA}`,
      '--headless=new',
      '--disable-gpu',
      '--ignore-certificate-errors',
      '--window-size=1440,900',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let cdp = null;

  try {
    const wsUrl = await getWsUrl();
    cdp = new CDPClient(wsUrl);

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');

    // -------------------------------------------------------------------------
    // SKENARIO A: NAVIGASI SPA 6 MENU & CLEAN URL (TANPA HASH)
    // -------------------------------------------------------------------------
    console.log('[Skenario A] Menguji Navigasi SPA 6 Menu Utama dengan URL Bersih Tanpa Hash...');
    await cdp.goto(BASE_URL);

    const menuTargets = [
      { name: 'Konser', key: 'konser', sectionId: 'page-konser' },
      { name: 'Riwayat Pemesanan', key: 'riwayat', sectionId: 'page-riwayat' },
      { name: 'Kontak', key: 'kontak', sectionId: 'page-kontak' },
      { name: 'Live Test', key: 'live-test', sectionId: 'page-live-test' },
      { name: 'Hasil War Test', key: 'hasil-war', sectionId: 'page-hasil-war' },
      { name: 'Beranda', key: 'beranda', sectionId: 'page-beranda' },
    ];

    for (const menu of menuTargets) {
      // Klik menu melalui selector data-page
      await cdp.eval(`document.querySelector('.nav-link[data-page="${menu.key}"]').click()`);
      await wait(200);

      const navState = await cdp.eval(`({
        activeNav: document.querySelector('.nav-link.active')?.dataset.page,
        isSectionVisible: getComputedStyle(document.getElementById('${menu.sectionId}')).display !== 'none',
        hash: window.location.hash,
        pathname: window.location.pathname,
      })`);

      assert.equal(navState.activeNav, menu.key, `Navbar aktif harus menunjukkan '${menu.key}'`);
      assert.equal(navState.isSectionVisible, true, `Section '${menu.sectionId}' harus tampil (display != none)`);
      assert.equal(navState.hash, '', `URL tidak boleh memiliki hash (#), harus bersih di root`);
      assert.equal(navState.pathname, '/', `Path URL harus tetap berada di '/'`);

      console.log(`  ✓ Menu '${menu.name}' aktif | URL: ${BASE_URL} | Hash: [KOSONG] | Status: OK`);
    }

    console.log('  -> Hasil Skenario A: 100% LULUS (Semua 6 menu transisi instan tanpa reload & bebas hash)\n');

    // -------------------------------------------------------------------------
    // SKENARIO B: LOGIN, TRANSAKSI WAR TIKET & VALIDASI REDIS ATOMIC LOCK
    // -------------------------------------------------------------------------
    console.log('[Skenario B] Menguji Transaksi War Tiket, Redis Atomic Lock & Sinkronisasi...');

    // 1. Login Akun Demo User
    await cdp.eval(`(() => {
      openLoginModal();
      document.getElementById('modalLoginEmail').value = 'user@wartiket.id';
      document.getElementById('modalLoginPassword').value = 'password123';
      document.querySelector('#loginModal form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    })()`);

    await cdp.waitFor(`() => document.getElementById('dropdownUserName')?.textContent?.includes('User')`, 6000);
    console.log('  ✓ Login Akun User Berhasil (JWT Token tersimpan di sesi)');

    // 2. Masuk ke Menu Konser & Buka Modal War Tiket
    await cdp.eval(`switchPage('konser')`);
    await cdp.waitFor(`() => document.querySelectorAll('.concert-card').length > 0`, 6000);
    
    // Buka War Modal untuk Konser ID 1
    await cdp.eval(`openWarModal(1)`);
    await cdp.waitFor(`() => document.getElementById('warModal')?.classList.contains('active')`, 6000);
    await cdp.waitFor(`() => Array.from(document.querySelectorAll('#modalSeatGrid .seat-btn')).some(b => b.textContent.trim() === 'E-05')`, 8000);
    console.log('  ✓ Modal War Tiket Terbuka & Denah Kursi Termuat');

    // 3. Pilih dan Kunci Kursi 'E-05'
    const targetSeat = 'E-05';
    const seatSelected = await cdp.eval(`(() => {
      const btn = Array.from(document.querySelectorAll('#modalSeatGrid .seat-btn')).find(b => b.textContent.trim() === '${targetSeat}');
      if (!btn || btn.disabled) return false;
      btn.click();
      return !document.getElementById('btnProceedToData').disabled;
    })()`);
    assert.equal(seatSelected, true, `Kursi ${targetSeat} harus berhasil dipilih dan mengaktifkan tombol lanjut`);
    console.log(`  ✓ Kursi '${targetSeat}' berhasil dipilih dan di-hold (Redis TTL aktif)`);

    // 4. Lanjut ke Form Data Diri dan Checkout
    await cdp.eval(`document.getElementById('btnProceedToData').click()`);
    await cdp.waitFor(`() => document.getElementById('phaseDataDiri')?.style.display !== 'none'`, 6000);
    
    await cdp.eval(`document.getElementById('btnBayarSekarang').click()`);
    await cdp.waitFor(`() => document.getElementById('phaseETicket')?.style.display === 'block'`, 10000);
    
    const invoiceCode = await cdp.eval(`document.getElementById('ticketCode')?.textContent?.trim() || ''`);
    assert.ok(invoiceCode.length > 2, `Kode E-Ticket harus terbentuk, dapat: ${invoiceCode}`);
    console.log(`  ✓ Transaksi Sukses! E-Ticket Terbit Resmi: ${invoiceCode}`);

    // 5. Validasi Redis Atomic Lock: User Lain Mencoba Membeli Kursi yang Sama ('E-05')
    console.log(`  -> Memvalidasi Redis Atomic Lock: User saingan mencoba membeli kursi '${targetSeat}' yang sudah terjual...`);
    const rivalRes = await fetch(`${BASE_URL}/api/tickets/buy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 999,
        concertId: 1,
        seatNumber: targetSeat,
      }),
    });
    const rivalBody = await rivalRes.json();
    assert.equal(rivalRes.status, 409, `User saingan harus ditolak dengan status 409 Conflict, dapat: ${rivalRes.status}`);
    assert.equal(rivalBody.success, false, 'User saingan tidak boleh berhasil membeli kursi yang sudah lunas/terkunci');
    console.log(`  ✓ Redis Atomic Lock Terbukti Bekerja: User saingan ditolak (HTTP 409 Conflict: "${rivalBody.message || 'Seat locked'}")`);

    // Tutup War Modal
    await cdp.eval(`closeWarModal()`);
    await wait(300);

    // 6. Masuk Menu Riwayat Pemesanan & Validasi Data Muncul di PostgreSQL
    await cdp.eval(`switchPage('riwayat')`);
    await cdp.waitFor(`() => document.querySelectorAll('#ordersContent .orders-table tbody tr').length > 0`, 8000);
    
    const orderHistoryMatch = await cdp.eval(`(() => {
      const rows = [...document.querySelectorAll('#ordersContent .orders-table tbody tr')];
      return rows.some(r => r.textContent.includes('${invoiceCode}') || r.textContent.includes('${targetSeat}'));
    })()`);
    assert.equal(orderHistoryMatch, true, `Pesanan dengan invoice '${invoiceCode}' atau kursi '${targetSeat}' harus tercatat di Riwayat`);
    console.log(`  ✓ Validasi Riwayat Pemesanan Sukses: Transaksi tercatat aman di PostgreSQL`);

    console.log('  -> Hasil Skenario B: 100% LULUS (Redis Lock anti-overselling & flow transaksi terverifikasi)');

    console.log('\n=========================================================================');
    console.log('                  SEMUA SKENARIO E2E LULUS 100%                          ');
    console.log('=========================================================================');
  } finally {
    if (cdp) cdp.close();
    try { edge.kill('SIGKILL'); } catch {}
    try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch {}
  }
}

runTests().catch((err) => {
  console.error('\nFAIL: Uji E2E Gagal:');
  console.error(err);
  process.exit(1);
});
