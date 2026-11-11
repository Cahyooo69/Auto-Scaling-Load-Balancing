/**
 * Runnable End-to-End & Anti-Stuck Browser Test via Microsoft Edge CDP (No External Deps)
 * Covers Gherkin Skenario 1, 2, 3, 3b (anti-stuck recovery), and 4 against live cluster.
 *
 * Run: node tests/e2e-war-tiket.mjs
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE_URL = (process.env.TARGET_URL || 'http://localhost').replace(/\/+$/, '');
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CDP_PORT = Number(process.env.CDP_PORT || 9235);
const USER_DATA = path.join(os.tmpdir(), `wartiket-e2e-${Date.now()}`);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
  throw new Error('Could not connect to Microsoft Edge CDP');
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
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.consoleErrors.push((msg.params.args || []).map((a) => a.value || a.description).join(' '));
      } else if (msg.method === 'Network.responseReceived' && msg.params.response?.status >= 400) {
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
      await wait(120);
    }
    throw new Error(`Timed out waiting for: ${fnExpr}`);
  }
  async goto(url) {
    await this.send('Page.navigate', { url });
    await this.waitFor(`() => document.readyState === 'complete'`);
    await wait(500);
  }
  close() {
    try { this.ws.close(); } catch {}
  }
}

async function resetDemoQuota() {
  const res = await fetch(`${BASE_URL}/api/tickets/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(res.status, 200, 'Reset quota API must return HTTP 200');
}

async function main() {
  assert.ok(fs.existsSync(EDGE_PATH), `Edge executable not found at ${EDGE_PATH}`);
  await resetDemoQuota();

  const edge = spawn(
    EDGE_PATH,
    [
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${USER_DATA}`,
      '--headless=new',
      '--disable-gpu',
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
    await cdp.send('DOM.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    // -----------------------------------------------------------------------
    // SKENARIO 1: Multi-POV Demo Account Authentication (4 POVs)
    // -----------------------------------------------------------------------
    console.log('[Skenario 1] Testing 4 POV demo logins on / ...');
    await cdp.goto(`${BASE_URL}/`);

    const povCases = [
      { email: 'dosen@wartiket.id', expectedSnippet: 'Budi' },
      { email: 'mahasiswa1@wartiket.id', expectedSnippet: 'Cloud' },
      { email: 'vip.buyer@gmail.com', expectedSnippet: 'Siti' },
      { email: 'festival.fan@gmail.com', expectedSnippet: 'Andi' },
    ];

    for (const pov of povCases) {
      await cdp.eval(`(() => {
        if (state?.currentUser) handleLogout();
        document.getElementById('navBtnAuth').click();
        autoFill(${JSON.stringify(pov.email)}, 'password123');
        document.getElementById('btnLoginSubmit').click();
      })()`);

      await cdp.waitFor(`() => state?.currentUser?.email === ${JSON.stringify(pov.email)}`);
      const navText = await cdp.eval(`document.getElementById('navAuthLabel')?.textContent?.trim()`);
      assert.ok(
        navText && navText !== 'Masuk',
        `Navbar label must update after login for ${pov.email}, got "${navText}"`
      );
      const userFullName = await cdp.eval(`state?.currentUser?.name || ''`);
      assert.ok(
        userFullName.includes(pov.expectedSnippet),
        `Expected full name for ${pov.email} to include "${pov.expectedSnippet}", got "${userFullName}"`
      );
    }
    // Leave logged in as Dosen Penguji (long academic title) for Scenario 3 & 4 print check
    await cdp.eval(`(() => {
      handleLogout();
      document.getElementById('navBtnAuth').click();
      autoFill('dosen@wartiket.id', 'password123');
      document.getElementById('btnLoginSubmit').click();
    })()`);
    await cdp.waitFor(`() => state?.currentUser?.email === 'dosen@wartiket.id'`);
    console.log('  OK: All 4 POV demo logins verified & left signed in as Dosen Penguji.');

    // -----------------------------------------------------------------------
    // SKENARIO 2: Multi-Page Navigation, Zero Dead Links ('Cara War' Removed), Scroll-Locked Navbar
    // -----------------------------------------------------------------------
    console.log('[Skenario 2] Testing multi-page routes, zero dead links, navbar scroll lock, and 3-column footer...');
    const routes = [
      { path: '/', expectSearch: true },
      { path: '/konser', expectSearch: true },
      { path: '/kontak', expectSearch: false },
    ];

    for (const r of routes) {
      await cdp.goto(`${BASE_URL}${r.path}`);
      const audit = await cdp.eval(`(() => {
        const nav = document.querySelector('.navbar');
        const navRect0 = nav ? nav.getBoundingClientRect() : { top: -999, bottom: -999 };
        const heroEl = document.querySelector('.hero-card, .page-hero-band');
        const heroTop0 = heroEl ? heroEl.getBoundingClientRect().top : 999;
        window.scrollTo(0, 600);
        const scrollYAfter = window.scrollY;
        const navRectAfter = nav ? nav.getBoundingClientRect() : { top: -999, bottom: -999 };
        window.scrollTo(0, 0);
        const navLabels = [...document.querySelectorAll('.nav-menu .nav-link')].map((el) => el.textContent.trim());
        const footerNavLabels = [...document.querySelectorAll('.site-footer .footer-links a')].map((el) => el.textContent.trim());
        const deadCaraWarLinks = [...document.querySelectorAll('a[href*="cara-war"], a[href*="guide.html"]')].length;
        const searchBtn = document.getElementById('btnToggleSearchPanel');
        const footerCols = document.querySelector('.site-footer .footer-inner')
          ? getComputedStyle(document.querySelector('.site-footer .footer-inner')).gridTemplateColumns.split(' ').length
          : 0;
        return {
          navLabels,
          footerNavLabels,
          deadCaraWarLinks,
          navPosition: nav ? getComputedStyle(nav).position : '',
          navBefore: navRect0.top,
          heroBelowNav: heroTop0 >= navRect0.bottom - 1,
          scrollYAfter,
          navStaysAtTopOfPage: navRectAfter.bottom <= 0,
          hasSearch: Boolean(searchBtn),
          footerCols,
          statusText: document.getElementById('footerClusterStatus')?.textContent?.trim() || '',
          hasResetBtn: Boolean(document.querySelector('.btn-footer-reset')),
        };
      })()`);

      assert.deepEqual(audit.navLabels, ['Beranda', 'Konser', 'Kontak'], `Unexpected header nav items on ${r.path}`);
      assert.deepEqual(audit.footerNavLabels, ['Beranda', 'Daftar Konser', 'Kontak & Bantuan'], `Unexpected footer nav items on ${r.path}`);
      assert.equal(audit.deadCaraWarLinks, 0, `Dead Cara War links must not exist on ${r.path}`);
      assert.equal(audit.hasSearch, r.expectSearch, `Search icon presence mismatch on ${r.path}`);
      assert.equal(audit.navPosition, 'relative', `Navbar must stay stationary inside #stage on ${r.path}`);
      assert.ok(audit.navBefore >= 0 && audit.navBefore <= 40, `Navbar initial top out of bounds on ${r.path}: ${audit.navBefore}`);
      assert.ok(audit.heroBelowNav, `Hero must start cleanly below navbar on ${r.path}`);
      if (audit.scrollYAfter > 200) {
        assert.ok(audit.navStaysAtTopOfPage, `Navbar must NOT follow scroll down on ${r.path}`);
      }
      assert.equal(audit.footerCols, 3, `Expected 3 footer columns on desktop for ${r.path}, got ${audit.footerCols}`);
      assert.ok(audit.statusText.length > 0 && audit.hasResetBtn, `Footer cluster status or reset button missing on ${r.path}`);
    }
    const contactCardCheck = await cdp.eval(`(() => {
      const cards = [...document.querySelectorAll('.contact-card')].map((el) => {
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      });
      return cards;
    })()`);
    assert.equal(contactCardCheck.length, 2, 'Contact page must render 2 contact cards');
    assert.ok(
      Math.abs(contactCardCheck[0].w - contactCardCheck[1].w) <= 2 &&
        Math.abs(contactCardCheck[0].h - contactCardCheck[1].h) <= 2,
      `Contact & FAQ cards must share equal size on desktop: ${JSON.stringify(contactCardCheck)}`
    );
    const removedRouteRes = await fetch(`${BASE_URL}/cara-war`);
    assert.equal(removedRouteRes.status, 404, 'Removed /cara-war route must return HTTP 404 cleanly');
    console.log('  OK: Multi-page routing, zero dead links, removed /cara-war (404), fixed navbar, and 3-col footer passed.');

    // -----------------------------------------------------------------------
    // SKENARIO 3 & 4: War E-05 -> E-Ticket + Print/PDF + Conflict + Anti-Stuck
    // -----------------------------------------------------------------------
    console.log('[Skenario 3 & 4] Testing War Seat E-05 on /konser -> Checkout -> E-Ticket -> Print/PDF...');
    await cdp.goto(`${BASE_URL}/konser`);
    await cdp.waitFor(`() => document.querySelectorAll('.concert-card').length > 0`);

    await cdp.eval(`openWarModal(1)`);
    await cdp.waitFor(`() => Array.from(document.querySelectorAll('#modalSeatGrid .seat-btn')).some(b => b.textContent.trim() === 'E-05')`);

    // Verify live queue status bar appeared during modal entry
    const queueBarText = await cdp.eval(`document.getElementById('warQueueStatusBar')?.textContent?.trim() || ''`);
    assert.ok(queueBarText.includes('Giliran Anda') && queueBarText.includes('Node:'), `Queue status bar must display active status & node, got "${queueBarText}"`);

    const step1Ready = await cdp.eval(`(() => {
      const btn = Array.from(document.querySelectorAll('#modalSeatGrid .seat-btn')).find(b => b.textContent.trim() === 'E-05');
      if (!btn || btn.disabled) return false;
      btn.click();
      return !document.getElementById('btnProceedToData').disabled;
    })()`);
    assert.ok(step1Ready, 'Seat E-05 must be available and enable "Lanjut ke Data Diri" button');

    await cdp.eval(`document.getElementById('btnProceedToData').click()`);
    await cdp.waitFor(`() => document.getElementById('phaseDataDiri')?.style.display !== 'none'`);

    const buyerPrefill = await cdp.eval(`document.getElementById('buyerFullName')?.value`);
    assert.ok(buyerPrefill.includes('Dr. Ir. Budi Santoso'), `Buyer name prefill mismatch: "${buyerPrefill}"`);

    await cdp.eval(`document.getElementById('btnBayarSekarang').click()`);
    await cdp.waitFor(`() => document.getElementById('phaseETicket')?.style.display === 'block'`, 10000);

    const ticketInfo = await cdp.eval(`({
      seat: document.getElementById('ticketSeat')?.textContent?.trim(),
      buyer: document.getElementById('ticketBuyer')?.textContent?.trim(),
      orderId: document.getElementById('ticketCode')?.textContent?.trim(),
    })`);
    assert.equal(ticketInfo.seat, 'E-05', 'E-Ticket must display seat E-05');
    assert.ok(ticketInfo.buyer.includes('Dr. Ir. Budi Santoso, M.Kom'), 'E-Ticket must show full buyer title');
    assert.ok(ticketInfo.orderId && ticketInfo.orderId !== '-' && ticketInfo.orderId !== 'TRX-XXXX', 'E-Ticket must contain Order ID');

    // Skenario 4: Emulate Print Media & Verify 1-page clean PDF without worker box/buttons
    await cdp.send('Emulation.setEmulatedMedia', { media: 'print' });
    await wait(200);
    const printVisibility = await cdp.eval(`(() => {
      const rectSize = (el) => {
        if (!el) return -1;
        const r = el.getBoundingClientRect();
        return r.width + r.height;
      };
      return {
        stageDisplay: getComputedStyle(document.getElementById('stage')).display,
        navbarRectSize: rectSize(document.querySelector('.navbar')),
        footerRectSize: rectSize(document.querySelector('.site-footer')),
        workerDisplay: getComputedStyle(document.querySelector('.eticket-worker-box')).display,
        actionsDisplay: getComputedStyle(document.querySelector('.eticket-actions')).display,
        ticketPaperDisplay: getComputedStyle(document.getElementById('eTicketPrintArea')).display,
      };
    })()`);
    assert.equal(printVisibility.stageDisplay, 'none', '#stage (containing navbar & footer) must be hidden in print media');
    assert.equal(printVisibility.navbarRectSize, 0, 'Navbar rendered box must collapse to 0 in print media');
    assert.equal(printVisibility.footerRectSize, 0, 'Footer rendered box must collapse to 0 in print media');
    assert.equal(printVisibility.workerDisplay, 'none', 'Worker host debug badge must be hidden in print media');
    assert.equal(printVisibility.actionsDisplay, 'none', 'Action buttons must be hidden in print media');
    assert.notEqual(printVisibility.ticketPaperDisplay, 'none', 'E-Ticket paper must remain visible in print');

    const pdfRes = await cdp.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
    const pdfStr = Buffer.from(pdfRes.data, 'base64').toString('latin1');
    const pdfPageCount = (pdfStr.match(/\/Type\s*\/Page\b/g) || []).length;
    assert.equal(pdfPageCount, 1, `Print PDF must fit cleanly on 1 page, got ${pdfPageCount}`);
    await cdp.send('Emulation.setEmulatedMedia', { media: 'screen' });

    // Verify Seat E-05 is now marked Booked on fresh modal open
    await cdp.eval(`(() => { closeWarModal(); openWarModal(1); })()`);
    await cdp.waitFor(`() => Array.from(document.querySelectorAll('#modalSeatGrid .seat-btn')).some(b => b.textContent.trim() === 'E-05')`);
    const seatDisabledAfterWar = await cdp.eval(`(() => {
      const btn = Array.from(document.querySelectorAll('#modalSeatGrid .seat-btn')).find(b => b.textContent.trim() === 'E-05');
      return Boolean(btn && btn.disabled && btn.classList.contains('booked'));
    })()`);
    assert.ok(seatDisabledAfterWar, 'Seat E-05 must immediately show disabled booked status after war');

    // -----------------------------------------------------------------------
    // SKENARIO 3b: Anti-Stuck Verification (Simulated HTTP 504 & Fetch Hang)
    // -----------------------------------------------------------------------
    console.log('[Skenario 3b] Verifying anti-stuck error recovery & loading reset on mocked failures...');
    const antiStuck = await cdp.eval(`(async () => {
      const origFetch = window.fetch.bind(window);
      try {
        // 1) Simulate non-JSON 504 proxy error on loadSeats -> inline Retry button must appear
        window.fetch = async (url, opts) => {
          if (String(url).includes('/seats')) {
            return new Response('<html>504 Gateway Time-out</html>', {
              status: 504,
              headers: { 'Content-Type': 'text/html' },
            });
          }
          return origFetch(url, opts);
        };
        await loadSeats(1);
        const retryBtn = document.querySelector('#modalSeatGrid .btn-retry-inline');
        const banner = document.getElementById('warFeedbackBanner');
        const seatBannerShown = Boolean(banner && banner.classList.contains('active') && getComputedStyle(banner).display !== 'none');

        // Restore fetch, load clean seats, pick E-04, go to Data Diri
        window.fetch = origFetch;
        await loadSeats(1);
        const altBtn = Array.from(document.querySelectorAll('#modalSeatGrid .seat-btn')).find(b => b.textContent.trim() === 'E-04');
        altBtn.click();
        goToPhaseDataDiri();

        // 2) Simulate network exception on POST /api/tickets/buy -> button must unlock cleanly in finally
        window.fetch = async (url, opts) => {
          if (String(url).includes('/tickets/buy')) {
            throw new DOMException('Request timeout', 'AbortError');
          }
          return origFetch(url, opts);
        };
        await executeCheckout();
        const payBtn = document.getElementById('btnBayarSekarang');
        const backBtn = document.getElementById('btnBackToSeat');
        const buyBannerText = document.getElementById('warFeedbackBanner')?.textContent || '';

        return {
          hasRetryBtn: Boolean(retryBtn),
          seatBannerShown: Boolean(seatBannerShown),
          payBtnDisabledAfterFail: Boolean(payBtn?.disabled),
          payBtnTextAfterFail: payBtn?.textContent?.trim(),
          backBtnDisabledAfterFail: Boolean(backBtn?.disabled),
          buyBannerText,
          isCheckingOutFlag: Boolean(state.isCheckingOut),
        };
      } finally {
        window.fetch = origFetch;
      }
    })()`);

    assert.ok(antiStuck.hasRetryBtn && antiStuck.seatBannerShown, 'Seat load 504 must render retry button & inline alert');
    assert.equal(antiStuck.payBtnDisabledAfterFail, false, 'Checkout button must NOT remain disabled/stuck after timeout');
    assert.equal(antiStuck.backBtnDisabledAfterFail, false, 'Back button must re-enable after checkout failure');
    assert.equal(antiStuck.isCheckingOutFlag, false, 'state.isCheckingOut lock must reset in finally');
    assert.ok(antiStuck.buyBannerText.length > 0, 'User-friendly timeout message must appear in #warFeedbackBanner');

    // -----------------------------------------------------------------------
    // SKENARIO 3c: Queue Waiting-Room Transition (QUEUED -> ADMITTED) & Anti-Stuck
    // -----------------------------------------------------------------------
    console.log('[Skenario 3c] Verifying queue waiting-room transition (QUEUED -> ADMITTED) & queue error recovery...');
    const queueFlow = await cdp.eval(`(async () => {
      const origFetch = window.fetch.bind(window);
      let statusPollCount = 0;
      try {
        closeWarModal();
        window.fetch = async (url, opts) => {
          const u = String(url);
          if (u.includes('/api/queue/join')) {
            return new Response(JSON.stringify({
              success: true,
              status: 'QUEUED',
              queueToken: 'mock-q-tok-1',
              ticketNumber: 42,
              position: 3,
              aheadCount: 2,
              estimatedWaitSec: 1,
              servedBy: 'mock-worker-a',
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (u.includes('/api/queue/status')) {
            statusPollCount += 1;
            return new Response(JSON.stringify({
              success: true,
              status: 'ADMITTED',
              queueToken: 'mock-q-tok-1',
              ticketNumber: 42,
              position: 0,
              aheadCount: 0,
              estimatedWaitSec: 0,
              servedBy: 'mock-worker-b',
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          return origFetch(url, opts);
        };

        await openWarModal(1);
        const queuedVisible = document.getElementById('phaseQueueWaiting')?.style.display === 'block';
        const posDuringQueue = document.getElementById('queuePositionVal')?.textContent?.trim();

        // Wait for polling transition to ADMITTED across mock-worker-b
        const tStart = Date.now();
        while (Date.now() - tStart < 4000 && document.getElementById('phaseSeatSelection')?.style.display !== 'block') {
          await new Promise((r) => setTimeout(r, 100));
        }

        const seatPhaseVisibleAfterAdmit = document.getElementById('phaseSeatSelection')?.style.display === 'block';
        const barAfterAdmit = document.getElementById('warQueueStatusBar')?.textContent?.trim() || '';

        // Test queue join error shows anti-stuck retry button instead of infinite spinner
        closeWarModal();
        window.fetch = async (url, opts) => {
          if (String(url).includes('/api/queue/join')) {
            return new Response('<html>503 Service Unavailable</html>', { status: 503, headers: { 'Content-Type': 'text/html' } });
          }
          return origFetch(url, opts);
        };
        await openWarModal(1);
        const retryQueueVisible = getComputedStyle(document.getElementById('btnRetryQueue')).display !== 'none';

        return { queuedVisible, posDuringQueue, statusPollCount, seatPhaseVisibleAfterAdmit, barAfterAdmit, retryQueueVisible };
      } finally {
        window.fetch = origFetch;
        closeWarModal();
      }
    })()`);
    assert.ok(queueFlow.queuedVisible && queueFlow.posDuringQueue === '#3', `Queue waiting card must show position #3: ${JSON.stringify(queueFlow)}`);
    assert.ok(queueFlow.statusPollCount >= 1 && queueFlow.seatPhaseVisibleAfterAdmit, `Queue must transition smoothly to seat selection: ${JSON.stringify(queueFlow)}`);
    assert.ok(queueFlow.barAfterAdmit.includes('mock-worker-b'), `Queue status bar must sync across Swarm worker nodes: ${JSON.stringify(queueFlow)}`);
    assert.ok(queueFlow.retryQueueVisible, 'Queue 503 failure must expose #btnRetryQueue anti-stuck recovery button');
    console.log('  OK: Anti-stuck timeout/504 recovery, queue waiting transition, and 1-page Print/PDF verified.');

    // Check empty Data Diri validation blocks checkout cleanly with inline alert (no freeze)
    const emptyNameValidation = await cdp.eval(`(async () => {
      const prevName = document.getElementById('buyerFullName').value;
      document.getElementById('buyerFullName').value = '';
      await executeCheckout();
      const bannerText = document.getElementById('warFeedbackBanner')?.textContent || '';
      const bannerShown = document.getElementById('warFeedbackBanner')?.classList.contains('active');
      const isChecking = Boolean(state.isCheckingOut);
      document.getElementById('buyerFullName').value = prevName;
      return { bannerText, bannerShown, isChecking };
    })()`);
    assert.ok(emptyNameValidation.bannerShown && emptyNameValidation.bannerText.length > 0, 'Empty buyer name must trigger inline warning');
    assert.equal(emptyNameValidation.isChecking, false, 'Validation failure must never leave checkout locked');

    // Mobile responsive layout check across multiple smartphone resolutions (320px, 360px, 390px)
    console.log('[Mobile 320px / 360px / 390px] Verifying responsive layout, no overlaps, readable fonts, and touch modal...');
    const mobileViewports = [
      { width: 320, height: 568, minSeatW: 34 },
      { width: 360, height: 800, minSeatW: 38 },
      { width: 390, height: 844, minSeatW: 40 },
    ];
    for (const vp of mobileViewports) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: 2,
        mobile: true,
      });
      for (const mobPath of ['/', '/konser', '/kontak']) {
        await cdp.goto(`${BASE_URL}${mobPath}`);
        const m = await cdp.eval(`(() => {
          const brand = document.querySelector('.nav-brand')?.getBoundingClientRect();
          const actions = document.querySelector('.nav-actions')?.getBoundingClientRect();
          const navNoOverlap = !brand || !actions || brand.right <= actions.left + 2 || actions.top >= brand.bottom - 2;
          return {
            isMobileClass: document.body.classList.contains('is-mobile'),
            overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            bodyFontPx: parseFloat(getComputedStyle(document.body).fontSize),
            brokenImgs: [...document.querySelectorAll('img')].filter(i => !i.complete || i.naturalWidth === 0).length,
            navNoOverlap,
          };
        })()`);
        assert.ok(m.isMobileClass, `body.is-mobile must activate on touch ${vp.width}px for ${mobPath}`);
        assert.equal(m.overflowX, 0, `Mobile horizontal overflow must be 0 on ${mobPath} (${vp.width}px), got ${m.overflowX}`);
        assert.ok(m.bodyFontPx >= 14, `Mobile body font must be readable (>=14px), got ${m.bodyFontPx}`);
        assert.equal(m.brokenImgs, 0, `All images must load cleanly on mobile ${mobPath}`);
        assert.ok(m.navNoOverlap, `Navbar brand & actions must not overlap at ${vp.width}px on ${mobPath}`);
      }

      await cdp.goto(`${BASE_URL}/konser`);
      await cdp.eval(`openWarModal(1)`);
      await cdp.waitFor(`() => document.querySelectorAll('#modalSeatGrid .seat-btn').length === 60`);
      const mobileModal = await cdp.eval(`(() => {
        const card = document.querySelector('#warModal .modal-card').getBoundingClientRect();
        const seat = document.querySelector('#modalSeatGrid .seat-btn').getBoundingClientRect();
        return { cardLeft: card.left, cardRight: card.right, seatW: seat.width, seatH: seat.height };
      })()`);
      assert.ok(mobileModal.cardLeft >= 0 && mobileModal.cardRight <= vp.width, `Mobile modal overflows ${vp.width}px: ${JSON.stringify(mobileModal)}`);
      assert.ok(mobileModal.seatW >= vp.minSeatW && mobileModal.seatH >= 34, `Mobile seat buttons too small at ${vp.width}px: ${JSON.stringify(mobileModal)}`);
    }

    assert.equal(cdp.consoleErrors.length, 0, `Unexpected browser console errors: ${JSON.stringify(cdp.consoleErrors)}`);
    assert.equal(cdp.httpFailures.length, 0, `Unexpected HTTP >= 400 responses: ${JSON.stringify(cdp.httpFailures)}`);
    console.log('  OK: Zero console errors, zero HTTP 4xx/5xx asset failures, mobile 390px layout clean.');
  } finally {
    if (cdp) cdp.close();
    try { edge.kill(); } catch {}
    await wait(300);
    try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch {}
    await resetDemoQuota();
  }

  console.log('\nPASS: All Edge CDP E2E + Anti-Stuck + Print/PDF assertions succeeded.');
}

main().catch((err) => {
  console.error('\nFAIL:', err);
  process.exit(1);
});

