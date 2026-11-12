// SISTEM WAR TIKET KONSER MUSIK - Frontend UI Controller (Multi-Page Architecture)
// Modern Responsive Web Architecture + Sticky Navbar + Modal Overlays + E-Ticket Print.

// ============================================================================
// 1. RESPONSIVE VIEWPORT CONTROLLER
// ============================================================================

var stateReady = false;

function getScale() {
  return 1;
}

function isMobileViewport() {
  if (typeof window === 'undefined') return false;
  const cw = document.documentElement.clientWidth || window.innerWidth || 1440;
  return cw <= 768;
}

function fit() {
  const mobile = isMobileViewport();
  document.documentElement.classList.toggle('wt-mobile', mobile);
  document.body?.classList.toggle('is-mobile', mobile);
}

fit();
window.addEventListener('resize', fit);
window.addEventListener('DOMContentLoaded', fit);

// ============================================================================
// 2. APPLICATION STATE
// ============================================================================

const state = {
  activePage: 'beranda',
  concertsLoaded: false,

  currentUser: null,
  jwtToken: null,
  pendingWarConcertIds: null,
  lastWorkerHost: 'swarm-worker',

  allConcerts: [],
  filteredConcerts: [],
  selectedConcertIds: [],

  searchQuery: '',
  selectedCity: '',
  selectedDate: '',

  currentPage: 0,
  cardsPerPage: 3,

  warQueueIds: [],
  activeWarConcertId: 1,
  selectedConcert: null,
  seats: [],
  selectedSeat: null,
  selectedPaymentMethod: 'QRIS Instan (GoPay/OVO/ShopeePay/BCA)',

  queueToken: null,
  queueTicketNumber: null,
  queueStatus: null,

  isLoggingIn: false,
  isCheckingOut: false,
  isResetting: false,
  isRunningStressTest: false,

  warTestHistory: [],
};
stateReady = true;

// Restore persisted auth user, JWT token, selected concerts & war test results across reloads
try {
  const savedUser = sessionStorage.getItem('wartiket_user');
  if (savedUser) state.currentUser = JSON.parse(savedUser);
  const savedJwt = sessionStorage.getItem('wartiket_jwt');
  if (savedJwt) state.jwtToken = savedJwt;
  const savedIds = sessionStorage.getItem('wartiket_selected_concerts');
  if (savedIds) {
    const parsed = JSON.parse(savedIds);
    if (Array.isArray(parsed)) state.selectedConcertIds = parsed;
  }
  const savedHistory = sessionStorage.getItem('wartiket_war_test_history');
  if (savedHistory) {
    const parsedHistory = JSON.parse(savedHistory);
    if (Array.isArray(parsedHistory)) state.warTestHistory = parsedHistory;
  }
} catch (e) {
  // Ignore sessionStorage parse errors
}

// ============================================================================
// 3. UTILITIES: XSS ESCAPE, HIGHLIGHT, CITY/DATE EXTRACTOR, TOAST
// ============================================================================

function escapeHtml(raw) {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function highlightMatch(rawText, query) {
  const text = String(rawText ?? '');
  const q = (query || '').trim();
  if (!q) return escapeHtml(text);

  const safePattern = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${safePattern})`, 'gi');
  const parts = text.split(regex);
  return parts
    .map((part, idx) =>
      idx % 2 === 1
        ? `<mark class="search-highlight">${escapeHtml(part)}</mark>`
        : escapeHtml(part)
    )
    .join('');
}

function extractCity(concert) {
  if (concert.city) return concert.city;
  const venue = String(concert.venue || '');
  const knownCities = ['Jakarta', 'Bandung', 'Surabaya', 'Bali', 'Yogyakarta', 'Medan', 'Semarang'];
  for (const city of knownCities) {
    if (venue.toLowerCase().includes(city.toLowerCase())) return city;
  }
  const parts = venue.split(',');
  return parts.length > 1 ? parts[parts.length - 1].trim() : 'Jakarta';
}

function extractDateLabel(concertDate) {
  return String(concertDate || '').split(',')[0].trim();
}

let toastTimer = null;
function showToast(msg, isError = false) {
  const box = document.getElementById('toastBox');
  if (!box) return;
  box.textContent = msg;
  box.classList.toggle('is-error', Boolean(isError));
  box.classList.add('active');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('active', 'is-error'), 3800);
}

// Fetch JSON dengan proteksi timeout (AbortController) & tangkapan error non-JSON
async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 10000) {
  const { signal: externalSignal, ...fetchOpts } = options;
  const controller = new AbortController();
  let timedOut = false;

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      const abortErr = new Error('Permintaan dibatalkan.');
      abortErr.name = 'AbortError';
      abortErr.isExternalAbort = true;
      throw abortErr;
    }
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const res = await fetch(url, { ...fetchOpts, signal: controller.signal });
    const rawText = await res.text();
    let data = {};
    if (rawText) {
      try {
        data = JSON.parse(rawText);
      } catch (parseErr) {
        if (!res.ok) {
          throw new Error(`Server sibuk atau gangguan jaringan (HTTP ${res.status}). Silakan coba lagi.`);
        }
        throw new Error('Respons server tidak valid. Silakan coba lagi.');
      }
    }
    return { res, data };
  } catch (err) {
    if (err.name === 'AbortError') {
      if (timedOut) {
        const tErr = new Error('Koneksi melebihi batas waktu (timeout). Periksa jaringan dan coba lagi.');
        tErr.isTimeout = true;
        throw tErr;
      }
      err.isExternalAbort = Boolean(externalSignal?.aborted);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

// ============================================================================
// 4. HEALTH POLLING & CLUSTER MONITOR
// ============================================================================

let isPollingHealth = false;

async function pollHealth() {
  if (isPollingHealth) return;
  isPollingHealth = true;
  try {
    const opts = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(4000) } : {};
    const res = await fetch('/health', opts);
    if (!res.ok) return;
    const data = await res.json();

    state.lastWorkerHost = data.container || state.lastWorkerHost;

    const hostBadge = document.getElementById('liveHostBadge');
    const redisBadge = document.getElementById('liveRedisBadge');
    const dbBadge = document.getElementById('liveDbBadge');
    const footerStatus = document.getElementById('footerClusterStatus');

    if (hostBadge) hostBadge.textContent = data.container || 'Online';
    if (redisBadge) redisBadge.textContent = data.redis || 'Connected';
    if (dbBadge) dbBadge.textContent = data.database || 'Connected';
    if (footerStatus) {
      footerStatus.textContent = `Swarm: ${data.container || 'Active'} \u2022 Redis: ${data.redis || 'CONNECTED'}`;
    }
  } catch (e) {
    // Graceful offline fallback
  } finally {
    isPollingHealth = false;
  }
}

// ============================================================================
// 5. CONCERT DATA LOADING, FILTER DROPDOWNS & CAROUSEL ENGINE
// ============================================================================

let concertsFetchController = null;
let concertsFetchPromise = null;

async function fetchConcerts({ force = false, render = isConcertsPage() } = {}) {
  if (state.concertsLoaded && !force && state.allConcerts.length > 0) {
    if (render) {
      readSearchParamsFromUrl();
      applyFilters();
    }
    return state.allConcerts;
  }

  if (concertsFetchPromise && !force) {
    return concertsFetchPromise;
  }

  if (concertsFetchController) {
    concertsFetchController.abort();
  }
  concertsFetchController = new AbortController();
  const activeController = concertsFetchController;

  const track = document.getElementById('carouselTrack');
  if (render && track && state.allConcerts.length === 0) {
    track.innerHTML = `
      <div class="catalog-loading-state">
        <span class="ui-spinner ui-spinner-lg"></span>
        <span>Memuat jadwal konser terbaru...</span>
      </div>
    `;
  }

  concertsFetchPromise = (async () => {
    let dbConcerts = [];
    try {
      const { res, data } = await fetchJsonWithTimeout(
        '/api/concerts',
        { cache: 'no-store', signal: activeController.signal },
        6000
      );
      if (res.ok && Array.isArray(data)) {
        dbConcerts = data;
      }
    } catch (err) {
      if (err.isExternalAbort) return state.allConcerts;
      // Fallback below if network temporarily unreachable
    }

    if (dbConcerts.length === 0) {
      dbConcerts = [
        {
          id: 1,
          title: 'Coldplay - Music of the Spheres World Tour',
          artist: 'Coldplay',
          venue: 'Stadion Utama Gelora Bung Karno (GBK), Jakarta',
          city: 'Jakarta',
          concertDate: '15 Desember 2026, 19:30 WIB',
          price: 1500000,
          totalSeats: 500,
          availableSeats: 495,
          imageUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=900&q=80',
        },
        {
          id: 2,
          title: 'Sheila on 7 - Tunggu Aku Di Jakarta',
          artist: 'Sheila on 7',
          venue: 'JIExpo Kemayoran Open Space, Jakarta',
          city: 'Jakarta',
          concertDate: '20 Januari 2027, 20:00 WIB',
          price: 750000,
          totalSeats: 500,
          availableSeats: 497,
          imageUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=900&q=80',
        },
        {
          id: 3,
          title: 'Taylor Swift - The Eras Tour Jakarta',
          artist: 'Taylor Swift',
          venue: 'Jakarta International Stadium (JIS), Jakarta',
          city: 'Jakarta',
          concertDate: '28 Februari 2027, 19:00 WIB',
          price: 2250000,
          totalSeats: 500,
          availableSeats: 496,
          imageUrl: 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=900&q=80',
        },
      ];
    }

    let merged = dbConcerts.map((c) => ({
      ...c,
      city: extractCity(c),
      dateLabel: extractDateLabel(c.concertDate),
    }));

    state.allConcerts = merged;
    state.concertsLoaded = true;
    populateFilterDropdowns();

    // Hanya render kartu konser jika user memang sedang berada di halaman Konser
    if (isConcertsPage()) {
      readSearchParamsFromUrl();
      applyFilters();
      renderMultiSelectBar();
    }
    return state.allConcerts;
  })().finally(() => {
    concertsFetchPromise = null;
  });

  return concertsFetchPromise;
}

function populateSelectOptions(id, placeholder, values, selectedValue) {
  const sel = document.getElementById(id);
  if (!sel) return;
  sel.innerHTML =
    `<option value="">${placeholder}</option>` +
    values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  sel.value = selectedValue;
}

function populateFilterDropdowns(sourceList = null) {
  const list = Array.isArray(sourceList) && sourceList.length > 0
    ? sourceList
    : state.allConcerts;
  const cities = Array.from(new Set(list.map((c) => c.city).filter(Boolean))).sort();
  const dates = Array.from(new Set(list.map((c) => c.dateLabel).filter(Boolean)));

  populateSelectOptions('cityFilter', 'Semua Kota', cities, state.selectedCity);
  populateSelectOptions('dateFilter', 'Semua Tanggal', dates, state.selectedDate);
}

function renderConcertCardHtml(c, query) {
  const isSelected = state.selectedConcertIds.includes(c.id);
  const priceText = `Rp ${Number(c.price || 0).toLocaleString('id-ID')}`;

  return `
    <article class="concert-card ${isSelected ? 'is-selected' : ''}" data-concert-id="${c.id}">
      <div class="card-thumb-wrap">
        <img src="${escapeHtml(c.imageUrl)}" alt="${escapeHtml(c.title)}" decoding="async" draggable="false" onerror="if(!this.dataset.fb){this.dataset.fb='1';this.src='/img/concert-fallback.svg';}">
        <label class="card-select-toggle" onclick="event.stopPropagation()">
          <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleConcertSelection(${c.id})">
          <span>${isSelected ? 'Dipilih' : 'Pilih'}</span>
        </label>
        <span class="card-status-badge">Tersedia: ${Number(c.availableSeats || 0)} Tiket</span>
      </div>
      <div class="card-body">
        <div class="card-artist">${highlightMatch(c.artist, query)}</div>
        <h3 class="card-title">${highlightMatch(c.title, query)}</h3>
        <div class="card-meta-list">
          <div class="card-meta-item" title="${escapeHtml(c.venue)}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 21s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 7.2c0 7.3-8 11.8-8 11.8z"/><circle cx="12" cy="10" r="3"/></svg>
            <span>${highlightMatch(c.venue, query)}</span>
          </div>
          <div class="card-meta-item">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <span>${escapeHtml(c.concertDate)}</span>
          </div>
        </div>

        <div class="card-footer">
          <div class="card-price-box">
            <span class="card-price-label">Mulai dari</span>
            <span class="card-price-value">${priceText}</span>
          </div>
          <button type="button" class="btn-pill-primary" onclick="requireAuthAndOpenWar([${c.id}])">
            <span>War Sekarang</span>
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderCarousel() {
  const track = document.getElementById('carouselTrack');
  const emptyState = document.getElementById('emptySearchState');
  if (!track || !emptyState) return;

  const list = state.filteredConcerts;
  if (list.length === 0) {
    track.innerHTML = '';
    emptyState.classList.add('active');
    return;
  }

  emptyState.classList.remove('active');
  track.innerHTML = list
    .map((c) => renderConcertCardHtml(c, state.searchQuery))
    .join('');
}

// ============================================================================
// 6. PENCARIAN CERDAS, AUTOCOMPLETE (MAX 5) & SINKRONISASI QUERY ANTAR-HALAMAN
// ============================================================================

function isConcertsPage() {
  return state.activePage === 'konser';
}

function readSearchInputs() {
  state.searchQuery = document.getElementById('searchInput')?.value || '';
  state.selectedCity = document.getElementById('cityFilter')?.value || '';
  state.selectedDate = document.getElementById('dateFilter')?.value || '';
}

function readSearchParamsFromUrl() {
  if (!isConcertsPage()) return;
  const params = new URLSearchParams(window.location.search || '');
  if (!params.has('q') && !params.has('city') && !params.has('date')) return;

  state.searchQuery = params.get('q') || '';
  state.selectedCity = params.get('city') || '';
  state.selectedDate = params.get('date') || '';

  const qEl = document.getElementById('searchInput');
  const cEl = document.getElementById('cityFilter');
  const dEl = document.getElementById('dateFilter');
  if (qEl) qEl.value = state.searchQuery;
  if (cEl) cEl.value = state.selectedCity;
  if (dEl) dEl.value = state.selectedDate;
}

function buildConcertsSearchUrl() {
  const params = new URLSearchParams();
  if (state.searchQuery.trim()) params.set('q', state.searchQuery.trim());
  if (state.selectedCity.trim()) params.set('city', state.selectedCity.trim());
  if (state.selectedDate.trim()) params.set('date', state.selectedDate.trim());
  const qs = params.toString();
  return qs ? `/?${qs}#konser` : '#konser';
}

function applyFilters({ syncUrl = false } = {}) {
  const q = state.searchQuery.trim().toLowerCase();
  const city = state.selectedCity.trim().toLowerCase();
  const date = state.selectedDate.trim().toLowerCase();

  state.filteredConcerts = state.allConcerts.filter((c) => {
    const haystack = `${c.title} ${c.artist} ${c.venue} ${c.city}`.toLowerCase();
    const matchQuery = !q || haystack.includes(q);
    const matchCity = !city || String(c.city || '').toLowerCase() === city || String(c.venue || '').toLowerCase().includes(city);
    const matchDate = !date || String(c.concertDate || '').toLowerCase().includes(date);
    return matchQuery && matchCity && matchDate;
  });

  state.currentPage = 0;
  updateSearchSummary(Boolean(q || city || date));
  renderCarousel();

  if (syncUrl && isConcertsPage()) {
    const targetUrl = buildConcertsSearchUrl();
    window.history.replaceState(null, '', targetUrl);
  }
}

function updateSearchSummary(hasActiveFilter) {
  const bar = document.getElementById('searchSummaryBar');
  const textEl = document.getElementById('searchSummaryText');
  if (!bar || !textEl) return;

  if (!hasActiveFilter) {
    bar.classList.remove('active');
    textEl.innerHTML = '';
    return;
  }

  const count = state.filteredConcerts.length;
  const descParts = [];
  if (state.searchQuery.trim()) {
    descParts.push(`kata kunci '<strong>${escapeHtml(state.searchQuery.trim())}</strong>'`);
  }
  if (state.selectedCity.trim()) {
    descParts.push(`kota <strong>${escapeHtml(state.selectedCity.trim())}</strong>`);
  }
  if (state.selectedDate.trim()) {
    descParts.push(`tanggal <strong>${escapeHtml(state.selectedDate.trim())}</strong>`);
  }

  textEl.innerHTML = `<strong>${count}</strong> konser ditemukan untuk ${descParts.join(', ')}`;
  bar.classList.add('active');
}

function resetSearch() {
  state.searchQuery = '';
  state.selectedCity = '';
  state.selectedDate = '';

  ['searchInput', 'cityFilter', 'dateFilter'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  closeAllAutocompletes();
  applyFilters({ syncUrl: true });
}

function handleSearchSubmit(e) {
  e.preventDefault();
  readSearchInputs();
  closeAllAutocompletes();

  if (isConcertsPage()) {
    applyFilters({ syncUrl: true });
  } else {
    window.history.replaceState(null, '', buildConcertsSearchUrl());
    switchPage('konser', { updateHash: false });
  }
}

function closeAllAutocompletes() {
  document.querySelectorAll('.autocomplete-dropdown').forEach((el) => {
    el.classList.remove('active');
    el.innerHTML = '';
  });
}

function attachAutocomplete(inputId, dropdownId) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);
  if (!input || !dropdown) return;

  let activeIndex = -1;
  let currentMatches = [];

  function renderDropdown() {
    const q = input.value.trim();
    if (!q) {
      dropdown.classList.remove('active');
      dropdown.innerHTML = '';
      currentMatches = [];
      activeIndex = -1;
      return;
    }

    const qLower = q.toLowerCase();
    currentMatches = state.allConcerts
      .filter((c) => `${c.artist} ${c.title} ${c.venue} ${c.city}`.toLowerCase().includes(qLower))
      .slice(0, 5);

    if (currentMatches.length === 0) {
      dropdown.classList.remove('active');
      dropdown.innerHTML = '';
      activeIndex = -1;
      return;
    }

    dropdown.innerHTML = currentMatches
      .map(
        (c, idx) => `
        <button type="button" class="autocomplete-item ${idx === activeIndex ? 'is-highlighted' : ''}" data-idx="${idx}" role="option">
          <span><strong>${highlightMatch(c.artist, q)}</strong> &mdash; ${highlightMatch(c.title, q)}</span>
          <span class="autocomplete-item-meta">${escapeHtml(c.city)}</span>
        </button>
      `
      )
      .join('');
    dropdown.classList.add('active');

    dropdown.querySelectorAll('.autocomplete-item').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const chosen = currentMatches[Number(btn.dataset.idx)];
        if (chosen) pickSuggestion(chosen);
      });
    });
  }

  function pickSuggestion(concert) {
    input.value = concert.artist;
    readSearchInputs();
    closeAllAutocompletes();
    activeIndex = -1;

    if (isConcertsPage()) {
      applyFilters({ syncUrl: true });
    } else {
      window.history.replaceState(null, '', buildConcertsSearchUrl());
      switchPage('konser', { updateHash: false });
    }
  }

  input.addEventListener('focus', () => {
    if (!state.concertsLoaded) fetchConcerts({ render: false });
  });

  input.addEventListener('input', () => {
    readSearchInputs();
    activeIndex = -1;
    renderDropdown();
  });

  input.addEventListener('keydown', (e) => {
    const isOpen = dropdown.classList.contains('active') && currentMatches.length > 0;
    if (e.key === 'ArrowDown' && isOpen) {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % currentMatches.length;
      renderDropdown();
    } else if (e.key === 'ArrowUp' && isOpen) {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + currentMatches.length) % currentMatches.length;
      renderDropdown();
    } else if (e.key === 'Enter' && isOpen && activeIndex >= 0) {
      e.preventDefault();
      pickSuggestion(currentMatches[activeIndex]);
    } else if (e.key === 'Escape') {
      dropdown.classList.remove('active');
      activeIndex = -1;
    }
  });
}

function closeNavAccountDropdown() {
  document.getElementById('navAccountDropdown')?.classList.remove('active');
}

function toggleNavAccountDropdown() {
  closeAllAutocompletes();
  document.getElementById('navAccountDropdown')?.classList.toggle('active');
}

function handleAuthNavClick() {
  if (!state.currentUser) {
    closeAllAutocompletes();
    openLoginModal();
  } else {
    toggleNavAccountDropdown();
  }
}

// ============================================================================
// 7. ROUTING SPA BERBASIS HASH (#beranda, #konser, #kontak) & CLEANUP TIMER
// ============================================================================

const VALID_SPA_PAGES = ['beranda', 'konser', 'riwayat', 'kontak', 'admin', 'live-test', 'hasil-test'];
let ordersAbortController = null;
let stressTestController = null;

function resolvePageFromLocation() {
  const hash = (window.location.hash || '').replace(/^#\/?/, '').toLowerCase();
  if (VALID_SPA_PAGES.includes(hash)) return hash;

  const path = (window.location.pathname || '/').toLowerCase().replace(/\/+$/, '') || '/';
  if (path === '/admin' || path === '/admin.html') return 'admin';
  if (path === '/konser' || path === '/concerts.html') return 'konser';
  if (path === '/riwayat') return 'riwayat';
  if (path === '/kontak' || path === '/contact.html') return 'kontak';
  if (path === '/live-test') return 'live-test';
  if (path === '/hasil-test') return 'hasil-test';
  return 'beranda';
}

function stopTicketBookingTimers(targetPage) {
  stopQueuePolling();
  if (seatFetchController) {
    seatFetchController.abort();
    seatFetchController = null;
  }
  if (checkoutAbortController) {
    checkoutAbortController.abort();
    checkoutAbortController = null;
  }
  if (concertsFetchController && targetPage !== 'konser') {
    concertsFetchController.abort();
    concertsFetchController = null;
  }
  if (ordersAbortController && targetPage !== 'riwayat') {
    ordersAbortController.abort();
    ordersAbortController = null;
  }
  if (stressTestController && targetPage !== 'live-test') {
    stressTestController.abort();
    stressTestController = null;
  }
  if (document.getElementById('warModal')?.classList.contains('active')) {
    closeWarModal();
  }
}

function syncActiveNavByRoute(activeKey = state.activePage) {
  const isAdminArea = activeKey === 'admin' || activeKey === 'live-test' || activeKey === 'hasil-test';
  const isAdminUser = Boolean(state.currentUser && state.currentUser.role === 'admin');
  const isAdminMode = isAdminArea || isAdminUser;

  const navAdmin = document.getElementById('navAdminItem');
  if (navAdmin) {
    navAdmin.style.display = isAdminMode ? '' : 'none';
  }
  const dropAdmin = document.getElementById('dropdownAdminLink');
  if (dropAdmin) {
    dropAdmin.style.display = isAdminUser ? 'block' : 'none';
  }

  // Admin hanya melihat Dashboard Admin saja (sembunyikan Beranda, Konser, Riwayat, Kontak)
  document.querySelectorAll('.nav-item-buyer').forEach((li) => {
    li.style.display = isAdminMode ? 'none' : '';
  });

  document.querySelectorAll('.nav-link[data-page]').forEach((link) => {
    const isCurrent = link.dataset.page === activeKey;
    link.classList.toggle('active', isCurrent);
    if (isCurrent) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

function switchPage(pageName, { updateHash = true, scrollToTop = true, forceRefresh = false } = {}) {
  const normalized = String(pageName || '').replace(/^#\/?/, '').toLowerCase();
  const targetPage = VALID_SPA_PAGES.includes(normalized) ? normalized : 'beranda';

  closeNavAccountDropdown();
  closeAllAutocompletes();

  // Hentikan timer/polling pemesanan tiket & batalkan fetch tertunda saat berpindah halaman
  stopTicketBookingTimers(targetPage);

  state.activePage = targetPage;
  document.documentElement.setAttribute('data-active-page', targetPage);

  // Sembunyikan seluruh section halaman lain secara instan dan tampilkan target
  document.querySelectorAll('.spa-page[data-page-section]').forEach((section) => {
    const isTarget = section.dataset.pageSection === targetPage;
    section.classList.toggle('is-active', isTarget);
    section.classList.toggle('hidden', !isTarget);
    section.hidden = !isTarget;
  });

  syncActiveNavByRoute(targetPage);
  renderMultiSelectBar();

  if (updateHash) {
    const nextHash = `#${targetPage}`;
    const nextUrl = window.location.pathname !== '/' ? `/${nextHash}` : nextHash;
    if (window.location.hash !== nextHash || window.location.pathname !== '/') {
      window.history.pushState({ page: targetPage }, '', nextUrl);
    }
  }

  if (targetPage === 'konser') {
    if (!state.concertsLoaded || forceRefresh) {
      fetchConcerts({ force: forceRefresh, render: true });
    } else {
      readSearchParamsFromUrl();
      applyFilters();
    }
  } else if (targetPage === 'riwayat') {
    fetchMyOrders();
  } else if (targetPage === 'admin') {
    loadAdminDashboardData();
  } else if (targetPage === 'live-test') {
    refreshLiveTestQuota();
  } else if (targetPage === 'hasil-test') {
    renderHasilWarTestPage();
  }

  fit();
  if (scrollToTop) {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
}

function initSpaNavigation() {
  document.addEventListener('click', (e) => {
    const navTarget = e.target.closest('a[data-page]');
    if (!navTarget) return;
    e.preventDefault();
    const targetPage = navTarget.dataset.page || navTarget.getAttribute('href') || 'beranda';
    switchPage(targetPage);
  });

  window.addEventListener('hashchange', () => {
    switchPage(resolvePageFromLocation(), { updateHash: false });
  });

  window.addEventListener('popstate', () => {
    switchPage(resolvePageFromLocation(), { updateHash: false });
  });
}

// ============================================================================
// 8. MULTI-CONCERT SELECTION & MANDATORY LOGIN ROUTE GUARD
// ============================================================================

function toggleConcertSelection(concertId) {
  const idx = state.selectedConcertIds.indexOf(concertId);
  if (idx >= 0) {
    state.selectedConcertIds.splice(idx, 1);
  } else {
    state.selectedConcertIds.push(concertId);
  }
  try {
    sessionStorage.setItem('wartiket_selected_concerts', JSON.stringify(state.selectedConcertIds));
  } catch (e) {}

  renderCarousel();
  renderMultiSelectBar();
}

function clearSelectedConcerts() {
  state.selectedConcertIds = [];
  try {
    sessionStorage.removeItem('wartiket_selected_concerts');
  } catch (e) {}
  renderCarousel();
  renderMultiSelectBar();
}

function renderMultiSelectBar() {
  const bar = document.getElementById('multiSelectBar');
  const countEl = document.getElementById('multiSelectCount');
  const chipsEl = document.getElementById('multiSelectChips');
  if (!bar || !countEl || !chipsEl) return;

  const selectedList = state.selectedConcertIds
    .map((id) => state.allConcerts.find((c) => c.id === id))
    .filter(Boolean);

  if (!isConcertsPage() || selectedList.length === 0) {
    bar.classList.remove('active');
    chipsEl.innerHTML = '';
    return;
  }

  countEl.textContent = String(selectedList.length);
  chipsEl.innerHTML = selectedList
    .map((c) => `<span class="multi-select-chip">${escapeHtml(c.artist)}</span>`)
    .join('');
  bar.classList.add('active');
}

function startMultiConcertWar() {
  if (state.selectedConcertIds.length === 0) return;
  requireAuthAndOpenWar([...state.selectedConcertIds]);
}

function updateAuthUI() {
  const authLabel = document.getElementById('navAuthLabel');
  const dropName = document.getElementById('dropdownUserName');
  const dropEmail = document.getElementById('dropdownUserEmail');

  if (state.currentUser) {
    if (authLabel) authLabel.textContent = (state.currentUser.name || 'Akun').trim().split(/\s+/)[0];
    if (dropName) dropName.textContent = state.currentUser.name || 'User';
    if (dropEmail) dropEmail.textContent = state.currentUser.email || '';
  } else {
    if (authLabel) authLabel.textContent = 'Masuk';
    closeNavAccountDropdown();
  }

  syncActiveNavByRoute(state.activePage);
}

async function loadAdminDashboardData() {
  const nodeEl = document.getElementById('adminWorkerNode');
  const redisEl = document.getElementById('adminRedisStatus');
  const dbEl = document.getElementById('adminDbStatus');

  try {
    const res = await fetch('/health');
    if (res.ok) {
      const data = await res.json();
      if (nodeEl) nodeEl.textContent = data.container || 'localhost';
      if (redisEl) {
        redisEl.textContent = data.redis || 'CONNECTED';
        redisEl.style.color = data.redis === 'CONNECTED' ? '#10b981' : '#dc2626';
      }
      if (dbEl) {
        dbEl.textContent = data.database || 'CONNECTED';
        dbEl.style.color = data.database === 'CONNECTED' ? '#10b981' : '#dc2626';
      }
    }
  } catch (err) {
    console.error('Failed to fetch /health for admin', err);
  }

  loadAdminTransactions();
}

async function loadAdminTransactions() {
  const wrap = document.getElementById('adminTxTableWrap');
  const txCountEl = document.getElementById('adminTxCount');
  if (!wrap) return;

  try {
    const res = await fetch('/api/transactions');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const list = data.transactions || [];
    if (txCountEl) txCountEl.textContent = list.length;

    if (list.length === 0) {
      wrap.innerHTML = '<div class="catalog-loading-state"><span>Belum ada transaksi tiket tercatat di database.</span></div>';
      return;
    }

    let rows = list.map((tx) => {
      const timeStr = tx.created_at ? new Date(tx.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-';
      const numAmount = Number(tx.amount || 0);
      const amountStr = !isNaN(numAmount) && numAmount > 0 ? `Rp ${numAmount.toLocaleString('id-ID')}` : (tx.amount || '-');
      const userStr = tx.user_name ? `${escapeHtml(tx.user_name)} (${escapeHtml(tx.user_email || '')})` : (tx.user_email || 'Pengguna');
      const concertStr = escapeHtml(tx.concert_title || 'Konser');
      const seatStr = tx.seat_number ? escapeHtml(tx.seat_number) : '-';
      const orderId = escapeHtml(tx.order_id || '-');
      const worker = escapeHtml(tx.server_instance_id || 'node-worker');

      return `<tr>
        <td style="font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 700; color: var(--color-forest);">${orderId}</td>
        <td>${userStr}</td>
        <td><strong>${concertStr}</strong> &bull; Kursi ${seatStr}</td>
        <td style="font-family: 'JetBrains Mono', monospace;">${amountStr}</td>
        <td><span class="sla-badge is-pass" style="font-size: 11px; padding: 3px 8px;">${escapeHtml(tx.status || 'PAID')}</span></td>
        <td style="font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--color-text-muted);">${worker}</td>
        <td style="font-size: 12px; color: var(--color-text-muted);">${timeStr}</td>
      </tr>`;
    }).join('');

    wrap.innerHTML = `<table class="orders-table" style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr>
          <th>Order ID</th>
          <th>Pembeli</th>
          <th>Detail Tiket</th>
          <th>Total</th>
          <th>Status</th>
          <th>Worker Node</th>
          <th>Waktu</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
  } catch (err) {
    wrap.innerHTML = `<div class="catalog-loading-state" style="color: #dc2626;"><span>Gagal memuat log transaksi: ${escapeHtml(err.message)}</span></div>`;
  }
}

function requireAuthAndOpenWar(concertIds) {
  const ids = Array.isArray(concertIds) && concertIds.length > 0 ? concertIds : [1];
  if (!state.currentUser) {
    state.pendingWarConcertIds = ids;
    const notice = document.getElementById('loginGuardNotice');
    if (notice) notice.classList.add('active');
    openLoginModal();
    return;
  }
  openWarModal(ids);
}

// ============================================================================
// 9. LOGIN MODAL & HANDLER
// ============================================================================

function openLoginModal() {
  closeAllAutocompletes();
  closeNavAccountDropdown();
  const modal = document.getElementById('loginModal');
  if (modal) modal.classList.add('active');
}

function closeLoginModal() {
  document.getElementById('loginModal')?.classList.remove('active');
  document.getElementById('loginGuardNotice')?.classList.remove('active');
}

function autoFill(email, pass) {
  const emailInput = document.getElementById('modalLoginEmail');
  const passInput = document.getElementById('modalLoginPassword');
  if (emailInput) emailInput.value = email;
  if (passInput) passInput.value = pass;
}

async function handleLogin(e) {
  e.preventDefault();
  if (state.isLoggingIn) return;

  const email = document.getElementById('modalLoginEmail').value.trim();
  const password = document.getElementById('modalLoginPassword').value;
  const submitBtn = document.getElementById('btnLoginSubmit');

  state.isLoggingIn = true;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="ui-spinner ui-spinner-light"></span><span>Memverifikasi akun...</span>';
  }

  try {
    const { res, data } = await fetchJsonWithTimeout(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      },
      8000
    );

    if (!res.ok || !data.success) {
      showToast(data.message || 'Login gagal. Periksa email atau akun demo.', true);
      return;
    }

    state.currentUser = data.user;
    state.jwtToken = data.jwtToken || null;
    try {
      sessionStorage.setItem('wartiket_user', JSON.stringify(data.user));
      if (data.jwtToken) sessionStorage.setItem('wartiket_jwt', data.jwtToken);
    } catch (err) {}

    updateAuthUI();
    closeLoginModal();
    showToast(`Selamat datang, ${data.user.name}!`);

    if (data.user?.role === 'admin') {
      switchPage('admin');
    } else if (state.activePage === 'riwayat') {
      fetchMyOrders();
    }

    if (state.pendingWarConcertIds && state.pendingWarConcertIds.length > 0) {
      const nextIds = [...state.pendingWarConcertIds];
      state.pendingWarConcertIds = null;
      await openWarModal(nextIds);
    }
  } catch (err) {
    showToast(`Gagal login: ${err.message}`, true);
  } finally {
    state.isLoggingIn = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>Masuk Sekarang</span>';
    }
  }
}

function handleLogout() {
  state.currentUser = null;
  state.jwtToken = null;
  state.pendingWarConcertIds = null;
  try {
    sessionStorage.removeItem('wartiket_user');
    sessionStorage.removeItem('wartiket_jwt');
  } catch (e) {}
  fetch('/api/auth/logout', { method: 'POST', keepalive: true }).catch(() => {});
  closeNavAccountDropdown();
  closeWarModal();
  switchPage('beranda');
  updateAuthUI();
  if (state.activePage === 'riwayat') {
    fetchMyOrders();
  }
  showToast('Anda telah keluar dari akun.');
}

// ============================================================================
// 10. WAR TIKET MODAL, ANTI-STUCK REQUESTS, SEAT GRID & CHECKOUT
// ============================================================================

let seatFetchController = null;
let seatFetchRequestId = 0;
let checkoutAbortController = null;
let queueAbortController = null;
let queuePollTimer = null;
let queuePollErrors = 0;

function stopQueuePolling() {
  if (queuePollTimer) {
    clearTimeout(queuePollTimer);
    queuePollTimer = null;
  }
  if (queueAbortController) {
    queueAbortController.abort();
    queueAbortController = null;
  }
}

function leaveWarQueue() {
  const token = state.queueToken;
  state.queueToken = null;
  state.queueStatus = null;
  state.queueTicketNumber = null;
  if (!token) return;
  fetch('/api/queue/leave', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueToken: token }),
    keepalive: true,
  }).catch(() => {});
}

function renderQueueStatus(q) {
  const bar = document.getElementById('warQueueStatusBar');
  const ticketBadge = document.getElementById('queueTicketBadge');
  const posEl = document.getElementById('queuePositionVal');
  const aheadEl = document.getElementById('queueAheadVal');
  const etaEl = document.getElementById('queueEtaVal');
  const nodeEl = document.getElementById('queueNodeVal');

  if (q && q.queueToken) {
    state.queueToken = q.queueToken;
    state.queueTicketNumber = q.ticketNumber || state.queueTicketNumber;
    state.queueStatus = q.status;
  }

  if (bar && q) {
    const ticketLabel = q.ticketNumber ? `#${q.ticketNumber}` : 'Aktif';
    const isQueued = q.status === 'QUEUED';
    bar.classList.add('active');
    bar.classList.toggle('is-waiting', isQueued);
    bar.innerHTML = `
      <span class="queue-status-left">
        <span class="${isQueued ? 'ui-spinner' : 'dot-online'}"></span>
        <span>${isQueued ? `Dalam Antrean (Tiket ${ticketLabel})` : `Giliran Anda (${ticketLabel}) • Silakan Pilih Kursi`}</span>
      </span>
      <span class="queue-status-meta">Node: ${escapeHtml(q.servedBy || state.lastWorkerHost)}</span>
    `;
  } else if (bar) {
    bar.classList.remove('active', 'is-waiting');
    bar.innerHTML = '';
  }

  if (q) {
    if (ticketBadge) ticketBadge.textContent = `Nomor Antrean #${q.ticketNumber || 1}`;
    if (posEl) posEl.textContent = q.status === 'QUEUED' ? `#${q.position}` : 'AKTIF';
    if (aheadEl) aheadEl.textContent = String(q.aheadCount ?? 0);
    if (etaEl) etaEl.textContent = q.estimatedWaitSec ? `~${q.estimatedWaitSec}s` : 'Siap';
    if (nodeEl) nodeEl.textContent = q.servedBy || state.lastWorkerHost;
  }
}

function scheduleQueuePoll() {
  if (queuePollTimer) clearTimeout(queuePollTimer);
  queuePollTimer = setTimeout(pollWarQueueStatus, 1000);
}

async function pollWarQueueStatus() {
  const modalActive = document.getElementById('warModal')?.classList.contains('active');
  if (!modalActive || !state.queueToken || state.queueStatus !== 'QUEUED') return;

  if (queueAbortController) queueAbortController.abort();
  queueAbortController = new AbortController();

  try {
    const { res, data } = await fetchJsonWithTimeout(
      `/api/queue/status?token=${encodeURIComponent(state.queueToken)}`,
      { cache: 'no-store', signal: queueAbortController.signal },
      5000
    );

    if (res.status === 410 || data.status === 'EXPIRED') {
      queuePollErrors = 0;
      state.queueStatus = 'EXPIRED';
      showWarFeedback(data.message || 'Sesi antrean berakhir. Klik "Masuk Antrean Ulang" untuk melanjutkan.');
      document.getElementById('btnRetryQueue').style.display = 'inline-flex';
      return;
    }

    if (!res.ok) {
      throw new Error(data.message || `Gagal menyinkronkan antrean (HTTP ${res.status}).`);
    }

    queuePollErrors = 0;
    clearWarFeedback();
    renderQueueStatus(data);

    if (data.status === 'ADMITTED') {
      stopQueuePolling();
      await switchWarConcert(state.activeWarConcertId);
      return;
    }

    scheduleQueuePoll();
  } catch (err) {
    if (err.isExternalAbort) return;
    queuePollErrors += 1;
    if (queuePollErrors >= 3) {
      showWarFeedback(err.message || 'Koneksi antrean terputus. Klik "Masuk Antrean Ulang" agar tidak stuck.');
      const retryBtn = document.getElementById('btnRetryQueue');
      if (retryBtn) retryBtn.style.display = 'inline-flex';
      return;
    }
    scheduleQueuePoll();
  }
}

async function joinAndEnterWarQueue(concertId) {
  stopQueuePolling();
  queuePollErrors = 0;
  state.activeWarConcertId = concertId;
  state.selectedSeat = null;
  state.selectedConcert = state.allConcerts.find((c) => c.id === concertId) || state.allConcerts[0] || {
    id: concertId,
    title: 'Konser Pilihan',
    venue: 'Jakarta',
    price: 1500000,
  };

  renderWarConcertTabs();
  setWarStep(1);
  clearWarFeedback();

  const waitPhase = document.getElementById('phaseQueueWaiting');
  const seatPhase = document.getElementById('phaseSeatSelection');
  const dataPhase = document.getElementById('phaseDataDiri');
  const ticketPhase = document.getElementById('phaseETicket');
  const retryBtn = document.getElementById('btnRetryQueue');
  const waitTitle = document.getElementById('queueWaitingTitle');

  if (waitPhase) waitPhase.style.display = 'block';
  if (seatPhase) seatPhase.style.display = 'none';
  if (dataPhase) dataPhase.style.display = 'none';
  if (ticketPhase) ticketPhase.style.display = 'none';
  if (retryBtn) retryBtn.style.display = 'none';
  if (waitTitle) waitTitle.textContent = 'Menghubungkan ke Antrean Real-Time...';

  queueAbortController = new AbortController();
  try {
    const { res, data } = await fetchJsonWithTimeout(
      '/api/queue/join',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: state.currentUser?.id || 1, concertId }),
        signal: queueAbortController.signal,
      },
      6000
    );

    if (!res.ok) {
      throw new Error(data.message || `Antrean sedang padat (HTTP ${res.status}).`);
    }

    renderQueueStatus(data);

    if (data.status === 'ADMITTED') {
      await switchWarConcert(concertId);
      return;
    }

    if (waitTitle) waitTitle.textContent = 'Anda Berada di Ruang Antrean Resmi';
    scheduleQueuePoll();
  } catch (err) {
    if (err.isExternalAbort) return;
    if (waitTitle) waitTitle.textContent = 'Koneksi Antrean Terganggu';
    showWarFeedback(err.message || 'Gagal masuk antrean. Klik "Masuk Antrean Ulang".');
    if (retryBtn) retryBtn.style.display = 'inline-flex';
  }
}

function setWarStep(stepNumber) {
  [1, 2, 3].forEach((n) => {
    document.getElementById(`modalStep${n}`)?.classList.toggle('active', n === stepNumber);
  });
}

function showWarFeedback(msg, isError = true) {
  const banner = document.getElementById('warFeedbackBanner');
  if (!banner) return;
  banner.textContent = msg;
  banner.classList.toggle('is-error', Boolean(isError));
  banner.classList.add('active');
}

function clearWarFeedback() {
  const banner = document.getElementById('warFeedbackBanner');
  if (!banner) return;
  banner.textContent = '';
  banner.classList.remove('active', 'is-error');
}

async function openWarModal(concertIdsOrId) {
  closeAllAutocompletes();
  closeNavAccountDropdown();
  const ids = Array.isArray(concertIdsOrId) ? concertIdsOrId : [concertIdsOrId];
  state.warQueueIds = ids;
  state.isCheckingOut = false;
  clearWarFeedback();
  document.getElementById('warModal')?.classList.add('active');
  await joinAndEnterWarQueue(ids[0]);
}

async function switchWarConcert(concertId) {
  if (state.isCheckingOut) return;
  state.activeWarConcertId = concertId;
  state.selectedSeat = null;
  clearWarFeedback();

  state.selectedConcert = state.allConcerts.find((c) => c.id === concertId) || state.allConcerts[0] || {
    id: concertId,
    title: 'Konser Pilihan',
    venue: 'Jakarta',
    price: 1500000,
  };

  renderWarConcertTabs();
  setWarStep(1);

  const titleEl = document.getElementById('modalConcertTitle');
  const venueEl = document.getElementById('modalConcertVenue');
  if (titleEl) titleEl.textContent = state.selectedConcert.title;
  if (venueEl) venueEl.textContent = state.selectedConcert.venue;

  const waitPhase = document.getElementById('phaseQueueWaiting');
  if (waitPhase) waitPhase.style.display = 'none';
  document.getElementById('phaseSeatSelection').style.display = 'block';
  document.getElementById('phaseDataDiri').style.display = 'none';
  document.getElementById('phaseETicket').style.display = 'none';

  await loadSeats(concertId);
}

function renderWarConcertTabs() {
  const tabsWrap = document.getElementById('warConcertTabs');
  if (!tabsWrap) return;

  if (!state.warQueueIds || state.warQueueIds.length <= 1) {
    tabsWrap.innerHTML = '';
    tabsWrap.style.display = 'none';
    return;
  }

  tabsWrap.style.display = 'flex';
  tabsWrap.innerHTML = state.warQueueIds
    .map((id) => {
      const c = state.allConcerts.find((item) => item.id === id);
      const label = c ? c.artist : `Konser #${id}`;
      const isActive = id === state.activeWarConcertId;
      return `<button type="button" class="multi-tab-btn ${isActive ? 'active' : ''}" onclick="switchWarConcert(${id})">${escapeHtml(label)}</button>`;
    })
    .join('');
}

function closeWarModal() {
  stopQueuePolling();
  leaveWarQueue();
  renderQueueStatus(null);
  if (seatFetchController) {
    seatFetchController.abort();
    seatFetchController = null;
  }
  if (checkoutAbortController) {
    checkoutAbortController.abort();
    checkoutAbortController = null;
  }
  state.isCheckingOut = false;
  state.seats = [];
  state.selectedSeat = null;
  const grid = document.getElementById('modalSeatGrid');
  if (grid) grid.innerHTML = '';
  clearWarFeedback();
  document.getElementById('warModal')?.classList.remove('active');
}

async function loadSeats(concertId) {
  const grid = document.getElementById('modalSeatGrid');
  if (!grid) return;

  // Batalkan request denah kursi sebelumnya bila user berpindah konser cepat
  if (seatFetchController) {
    seatFetchController.abort();
  }
  seatFetchController = new AbortController();
  const reqId = ++seatFetchRequestId;

  grid.innerHTML = `
    <div class="loading-inline-row" style="grid-column: 1 / -1; text-align: center; padding: 24px; color: var(--color-text-muted);">
      <span class="ui-spinner"></span>
      <span>Memuat denah kursi real-time...</span>
    </div>
  `;

  try {
    const { res, data } = await fetchJsonWithTimeout(
      `/api/concerts/${concertId}/seats`,
      { cache: 'no-store', signal: seatFetchController.signal },
      8000
    );
    if (reqId !== seatFetchRequestId) return;

    if (!res.ok) {
      throw new Error(data.message || `Gagal memuat denah kursi (HTTP ${res.status}).`);
    }

    state.seats = data.seats || [];
    renderSeats();
  } catch (err) {
    if (err.isExternalAbort || reqId !== seatFetchRequestId) return;
    const msg = escapeHtml(err.message || 'Gagal memuat denah kursi.');
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 16px; color: #9b2c2c;">
        <div>${msg}</div>
        <button type="button" class="btn-retry-inline" onclick="loadSeats(${Number(concertId) || 1})">Coba Muat Ulang Kursi</button>
      </div>
    `;
    showWarFeedback(err.message || 'Gagal memuat denah kursi. Klik "Coba Muat Ulang Kursi".');
  }
}

function renderSeats() {
  const grid = document.getElementById('modalSeatGrid');
  if (!grid) return;

  grid.innerHTML = state.seats
    .map((s) => {
      const isBooked = s.status === 'Booked' || s.status === 'Locked';
      const isSelected = state.selectedSeat && state.selectedSeat.id === s.id;

      let cls = 'seat-btn available';
      if (isBooked) cls = 'seat-btn booked';
      else if (isSelected) cls = 'seat-btn selected';

      return `
        <button
          type="button"
          class="${cls}"
          title="Kursi ${escapeHtml(s.seatNumber)} (${escapeHtml(s.status)})"
          ${isBooked ? 'disabled' : ''}
          onclick="selectSeat(${s.id})">
          ${escapeHtml(s.seatNumber)}
        </button>
      `;
    })
    .join('');

  updateSeatSummary();
}

function selectSeat(seatId) {
  const s = state.seats.find((item) => item.id === seatId);
  if (!s || s.status === 'Booked' || s.status === 'Locked') return;
  clearWarFeedback();
  state.selectedSeat = s;
  renderSeats();
}

function updateSeatSummary() {
  const labelSeat = document.getElementById('labelChosenSeat');
  const labelPrice = document.getElementById('labelChosenPrice');
  const btnNext = document.getElementById('btnProceedToData');

  if (state.selectedSeat) {
    if (labelSeat) labelSeat.textContent = `${state.selectedSeat.seatNumber} (${state.selectedSeat.category || 'CAT 1'})`;
    if (labelPrice) labelPrice.textContent = `Rp ${Number(state.selectedSeat.price || state.selectedConcert?.price || 0).toLocaleString('id-ID')}`;
    if (btnNext) btnNext.disabled = false;
  } else {
    if (labelSeat) labelSeat.textContent = 'Belum Memilih';
    if (labelPrice) labelPrice.textContent = 'Rp 0';
    if (btnNext) btnNext.disabled = true;
  }
}

function selectPaymentMethod(method) {
  state.selectedPaymentMethod = method;
  const summaryEl = document.getElementById('summaryPaymentMethod');
  if (summaryEl) summaryEl.textContent = method;
  document.querySelectorAll('.payment-method-card').forEach((card) => {
    const radio = card.querySelector('input[type="radio"]');
    if (radio) {
      const isMatch = method.toLowerCase().includes(radio.value.toLowerCase().slice(0, 4));
      card.classList.toggle('active', isMatch);
      radio.checked = isMatch;
    }
  });
}

function goToPhaseDataDiri() {
  if (!state.selectedSeat) return;
  clearWarFeedback();
  setWarStep(2);

  document.getElementById('phaseSeatSelection').style.display = 'none';
  document.getElementById('phaseDataDiri').style.display = 'block';
  document.getElementById('phaseETicket').style.display = 'none';

  const u = state.currentUser || {};
  const c = state.selectedConcert || {};
  const s = state.selectedSeat || {};
  const finalPrice = Number(s.price || c.price || 0);

  document.getElementById('buyerFullName').value = u.name || '';
  document.getElementById('buyerEmailAddress').value = u.email || '';
  document.getElementById('summaryConcertName').textContent = c.title || '-';
  document.getElementById('summarySeatCode').textContent = s.seatNumber || '-';
  const summaryPay = document.getElementById('summaryPaymentMethod');
  if (summaryPay) summaryPay.textContent = state.selectedPaymentMethod || 'QRIS Instan (GoPay/OVO/ShopeePay/BCA)';
  document.getElementById('summaryTotalCost').textContent = `Rp ${finalPrice.toLocaleString('id-ID')}`;
}

function backToPhaseSeat() {
  if (state.isCheckingOut) return;
  setWarStep(1);
  document.getElementById('phaseSeatSelection').style.display = 'block';
  document.getElementById('phaseDataDiri').style.display = 'none';
}

async function executeCheckout() {
  if (state.isCheckingOut) return;

  if (!state.currentUser) {
    closeWarModal();
    showToast('Sesi login Anda habis. Silakan masuk kembali.', true);
    openLoginModal();
    return;
  }

  if (!state.selectedSeat) {
    backToPhaseSeat();
    showWarFeedback('Silakan pilih kursi yang tersedia terlebih dahulu.');
    return;
  }

  const nameInput = document.getElementById('buyerFullName');
  const emailInput = document.getElementById('buyerEmailAddress');
  const buyerNameVal = nameInput?.value?.trim() || '';
  const buyerEmailVal = emailInput?.value?.trim() || '';
  if (buyerNameVal.length < 2) {
    showWarFeedback('Nama lengkap penonton wajib diisi minimal 2 karakter.');
    nameInput?.focus();
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmailVal)) {
    showWarFeedback('Alamat email penonton tidak valid.');
    emailInput?.focus();
    return;
  }

  const btn = document.getElementById('btnBayarSekarang');
  const backBtn = document.getElementById('btnBackToSeat');
  state.isCheckingOut = true;
  clearWarFeedback();
  checkoutAbortController = new AbortController();

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="ui-spinner ui-spinner-light"></span><span>Mengunci kursi &amp; memproses transaksi...</span>';
  }
  if (backBtn) backBtn.disabled = true;

  try {
    const payload = {
      userId: state.currentUser?.id || 1,
      concertId: state.activeWarConcertId,
      seatId: state.selectedSeat?.id || null,
      seatNumber: state.selectedSeat?.seatNumber || null,
      queueToken: state.queueToken || null,
    };

    const { res, data } = await fetchJsonWithTimeout(
      '/api/tickets/buy',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: checkoutAbortController.signal,
      },
      10000
    );

    if (res.status === 409) {
      const conflictMsg = data.message || 'Kursi baru saja diamankan penonton lain. Silakan pilih kursi tersedia lainnya.';
      showWarFeedback(conflictMsg);
      showToast(conflictMsg, true);
      state.selectedSeat = null;
      state.isCheckingOut = false;
      backToPhaseSeat();
      await loadSeats(state.activeWarConcertId);
      return;
    }

    if (!res.ok || !data.success) {
      throw new Error(data.message || `Transaksi gagal diproses (HTTP ${res.status}).`);
    }

    displayETicket(data.ticket, data.servedBy);
    state.queueToken = null;
    state.queueStatus = null;
    state.concertsLoaded = false;
    showToast('Pembayaran Lunas! E-Ticket resmi telah terbit.');
    if (isConcertsPage()) {
      fetchConcerts({ force: true, render: true });
    }
  } catch (err) {
    if (err.isExternalAbort) return;
    const errMsg = err.message || 'Terjadi gangguan koneksi saat memproses checkout.';
    showWarFeedback(errMsg);
    showToast(errMsg, true);
  } finally {
    checkoutAbortController = null;
    state.isCheckingOut = false;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span>Bayar &amp; Amankan Tiket (War Tiket)</span>';
    }
    if (backBtn) backBtn.disabled = false;
  }
}

function displayETicket(t, host) {
  clearWarFeedback();
  setWarStep(3);
  document.getElementById('phaseDataDiri').style.display = 'none';
  document.getElementById('phaseETicket').style.display = 'block';

  const venue = t.concert?.venue || state.selectedConcert?.venue || '';
  const dateLabel = state.selectedConcert?.dateLabel || '';
  const venueMeta = [venue, dateLabel].filter(Boolean).join(' • ');
  const customBuyer = document.getElementById('buyerFullName')?.value?.trim();

  document.getElementById('ticketCode').textContent = t.orderId || 'TRX-SUCCESS';
  document.getElementById('ticketHostId').textContent = host || t.serverInstanceId || state.lastWorkerHost;
  document.getElementById('ticketConcert').textContent = t.concert?.title || state.selectedConcert?.title || '-';
  const venueEl = document.getElementById('ticketVenue');
  if (venueEl) venueEl.textContent = venueMeta;
  document.getElementById('ticketBuyer').textContent = customBuyer || t.user?.name || state.currentUser?.name || '-';
  document.getElementById('ticketSeat').textContent = t.seat?.seatNumber || state.selectedSeat?.seatNumber || '-';
  document.getElementById('ticketPrice').textContent = `Rp ${Number(t.amount || state.selectedSeat?.price || 0).toLocaleString('id-ID')}`;
  const payMethodEl = document.getElementById('ticketPaymentMethod');
  if (payMethodEl) payMethodEl.textContent = state.selectedPaymentMethod || 'QRIS Instan';
}

function renderStressQuotaBadges(quotas) {
  const wrap = document.getElementById('stressQuotaBadges');
  if (!wrap || !Array.isArray(quotas) || quotas.length === 0) return;

  wrap.innerHTML = quotas
    .slice(0, 3)
    .map((q) => {
      const avail = Number(q.availableSeats ?? 0);
      const total = Number(q.totalSeats || 500);
      return `<span class="stress-quota-chip">Konser #${Number(q.id)}: <strong>${avail}/${total}</strong></span>`;
    })
    .join('');
}

async function refreshLiveTestQuota() {
  try {
    const { res, data } = await fetchJsonWithTimeout('/api/concerts', { cache: 'no-store' }, 6000);
    if (res.ok && Array.isArray(data) && data.length > 0) {
      renderStressQuotaBadges(data);
    }
  } catch {}
}

function resetLiveTestUI(quotas = null) {
  const avgEl = document.getElementById('stressAvgLatency');
  const okEl = document.getElementById('stressOkCount');
  const conflictEl = document.getElementById('stressConflictCount');
  const errEl = document.getElementById('stressErrorRate');
  const slaBadge = document.getElementById('stressSlaBadge');
  const distWrap = document.getElementById('stressWorkerDist');

  if (avgEl) avgEl.textContent = '0 ms';
  if (okEl) okEl.textContent = '0';
  if (conflictEl) conflictEl.textContent = '0';
  if (errEl) errEl.textContent = '0%';
  if (slaBadge) {
    slaBadge.classList.add('is-pass');
    slaBadge.classList.remove('is-fail');
    slaBadge.textContent = 'Siap Diuji (Target SLA < 200ms)';
  }
  if (distWrap) {
    distWrap.innerHTML =
      '<div style="color: var(--color-text-muted); font-size: 14px;">Belum ada pengujian dijalankan. Klik <strong>Mulai War Test</strong> untuk melihat distribusi worker node secara langsung.</div>';
  }
  if (Array.isArray(quotas) && quotas.length > 0) {
    renderStressQuotaBadges(quotas);
  }
}

async function resetSystemStock(options = {}) {
  const { skipConfirm = false, sourceBtn = null } = options || {};
  if (state.isResetting) return;
  if (!skipConfirm && !confirm('Reset seluruh kuota tiket, Redis locks, dan database ke kondisi awal?')) return;

  // Batalkan stress test yang masih berjalan agar tombol Mulai War Test & Reset Kuota tidak stuck
  if (stressTestController) {
    stressTestController.abort();
    stressTestController = null;
  }
  state.isRunningStressTest = false;
  const startBtn = document.getElementById('btnStartStressTest');
  if (startBtn) {
    startBtn.disabled = false;
    startBtn.innerHTML = '<span>Mulai War Test</span>';
  }

  const resetBtn = sourceBtn || document.getElementById('btnResetStressTest');
  const prevHtml = resetBtn ? resetBtn.innerHTML : '';
  if (resetBtn) {
    resetBtn.disabled = true;
    resetBtn.innerHTML = '<span class="ui-spinner"></span><span>Mereset...</span>';
  }

  state.isResetting = true;
  try {
    const { res, data } = await fetchJsonWithTimeout('/api/tickets/reset', { method: 'POST' }, 10000);
    if (!res.ok || !data.success) {
      throw new Error(data.message || `Gagal mereset data (HTTP ${res.status}).`);
    }

    const fallbackQuotas = [1, 2, 3].map((id) => ({
      id,
      totalSeats: 500,
      availableSeats: Number(data.concertStocks?.[id] ?? 500),
    }));
    clearWarTestHistory({ silent: true });
    resetLiveTestUI(Array.isArray(data.concertQuotas) && data.concertQuotas.length > 0 ? data.concertQuotas : fallbackQuotas);

    state.concertsLoaded = false;
    if (isConcertsPage()) {
      await fetchConcerts({ force: true, render: true });
    } else if (state.activePage === 'live-test' && (!data.concertQuotas || data.concertQuotas.length === 0)) {
      await refreshLiveTestQuota();
    }
    if (document.getElementById('warModal')?.classList.contains('active')) {
      await loadSeats(state.activeWarConcertId);
    }
    showToast(data.message || 'Reset kuota & metrik simulasi selesai.');
  } catch (e) {
    showToast(`Gagal mereset: ${e.message}`, true);
  } finally {
    state.isResetting = false;
    if (resetBtn) {
      resetBtn.disabled = false;
      resetBtn.innerHTML = prevHtml || '<span>Reset Kuota</span>';
    }
  }
}

// ============================================================================
// 11. RIWAYAT PEMESANAN (JWT) & LIVE STRESS TEST RUNNER
// ============================================================================

async function fetchMyOrders() {
  const container = document.getElementById('ordersContent');
  const subtitle = document.getElementById('ordersSubtitle');
  if (!container) return;

  if (!state.currentUser) {
    if (subtitle) subtitle.textContent = 'Masuk akun untuk melihat daftar pesanan tiket Anda.';
    container.innerHTML = `
      <div class="catalog-loading-state">
        <span>Anda belum masuk akun. Masuk sebagai <strong>ADMIN</strong> atau <strong>USER</strong> untuk melihat riwayat pemesanan.</span>
        <button type="button" class="btn-pill-primary" onclick="openLoginModal()">
          <span>Masuk Sekarang</span>
        </button>
      </div>
    `;
    return;
  }

  if (subtitle) subtitle.textContent = `Riwayat pemesanan untuk ${state.currentUser.name} (${state.currentUser.email})`;
  container.innerHTML = `
    <div class="catalog-loading-state">
      <span class="ui-spinner ui-spinner-lg"></span>
      <span>Memuat riwayat pemesanan dari PostgreSQL...</span>
    </div>
  `;

  if (ordersAbortController) ordersAbortController.abort();
  ordersAbortController = new AbortController();

  try {
    const headers = {};
    if (state.jwtToken) headers.Authorization = `Bearer ${state.jwtToken}`;

    const { res, data } = await fetchJsonWithTimeout(
      '/api/bookings/my-orders',
      { headers, cache: 'no-store', signal: ordersAbortController.signal },
      8000
    );

    if (res.status === 401) {
      container.innerHTML = `
        <div class="catalog-loading-state">
          <span>Sesi JWT berakhir. Silakan masuk kembali untuk memuat riwayat pemesanan.</span>
          <button type="button" class="btn-pill-primary" onclick="openLoginModal()"><span>Masuk Kembali</span></button>
        </div>
      `;
      return;
    }

    if (!res.ok || !data.success) {
      throw new Error(data.message || `Gagal memuat riwayat (HTTP ${res.status}).`);
    }

    renderMyOrders(data.orders || []);
  } catch (err) {
    if (err.isExternalAbort) return;
    container.innerHTML = `
      <div class="catalog-loading-state" style="color: #9b2c2c;">
        <span>${escapeHtml(err.message || 'Gagal memuat riwayat pemesanan.')}</span>
        <button type="button" class="btn-retry-inline" onclick="fetchMyOrders()">Coba Muat Ulang</button>
      </div>
    `;
  }
}

function renderMyOrders(orders) {
  const container = document.getElementById('ordersContent');
  if (!container) return;

  if (!orders.length) {
    container.innerHTML = `
      <div class="catalog-loading-state">
        <span>Belum ada tiket yang dipesan pada akun ini.</span>
        <a href="#konser" class="btn-pill-primary" data-page="konser"><span>Cari Konser &amp; War Tiket</span></a>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="orders-table-wrap">
      <table class="orders-table">
        <thead>
          <tr>
            <th>Kode Booking</th>
            <th>Konser</th>
            <th>Kategori &amp; Kursi</th>
            <th>Total Harga</th>
            <th>Tanggal Pesan</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${orders
            .map((o) => {
              const st = String(o.status || 'PAID').toUpperCase();
              const cls = st === 'PAID' ? 'is-paid' : st === 'PENDING' ? 'is-pending' : 'is-expired';
              const dt = o.createdAt ? new Date(o.createdAt).toLocaleString('id-ID') : '-';
              return `
                <tr>
                  <td><strong class="font-mono selectable-text">${escapeHtml(o.bookingCode)}</strong></td>
                  <td>
                    <div style="font-weight: 800; color: var(--color-text);">${escapeHtml(o.concertTitle)}</div>
                    <div style="font-size: 12px; color: var(--color-text-muted);">${escapeHtml(o.concertVenue)}</div>
                  </td>
                  <td>
                    <div>${escapeHtml(o.seatCategory)}</div>
                    <strong class="font-mono" style="color: var(--color-forest);">${escapeHtml(o.seatNumber)}</strong>
                  </td>
                  <td><strong>Rp ${Number(o.totalAmount || 0).toLocaleString('id-ID')}</strong></td>
                  <td style="font-size: 13px; color: var(--color-text-muted);">${escapeHtml(dt)}</td>
                  <td><span class="status-pill ${cls}">${escapeHtml(st)}</span></td>
                </tr>
              `;
            })
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderWorkerDistributionBars(distWrap, workerNodes, emptyMessage) {
  if (!distWrap) return;
  const entries = Object.entries(workerNodes || {}).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    distWrap.innerHTML = `<div style="color: var(--color-text-muted); font-size: 14px;">${emptyMessage}</div>`;
    return;
  }
  const totalHandled = entries.reduce((sum, [, cnt]) => sum + cnt, 0) || 1;
  distWrap.innerHTML = entries
    .map(([node, cnt]) => {
      const pct = Math.round((cnt / totalHandled) * 100);
      return `
        <div class="worker-dist-row">
          <strong class="font-mono selectable-text">${escapeHtml(node)}</strong>
          <div class="worker-bar-track"><div class="worker-bar-fill" style="width: ${pct}%;"></div></div>
          <span class="font-mono" style="text-align: right;">${cnt} req</span>
        </div>
      `;
    })
    .join('');
}

function renderStressTestMetrics(metrics) {
  const avgEl = document.getElementById('stressAvgLatency');
  const okEl = document.getElementById('stressOkCount');
  const conflictEl = document.getElementById('stressConflictCount');
  const errEl = document.getElementById('stressErrorRate');
  const slaBadge = document.getElementById('stressSlaBadge');
  const distWrap = document.getElementById('stressWorkerDist');

  if (avgEl) avgEl.textContent = `${metrics.avgLatencyMs} ms`;
  if (okEl) okEl.textContent = String(metrics.ok200);
  if (conflictEl) conflictEl.textContent = String(metrics.conflict409);
  if (errEl) errEl.textContent = `${metrics.errorRatePct}%`;

  if (slaBadge) {
    const pass = Boolean(metrics.slaPassed);
    slaBadge.classList.toggle('is-pass', pass);
    slaBadge.classList.toggle('is-fail', !pass);
    slaBadge.textContent = pass
      ? `SLA TERPENUHI (${metrics.avgLatencyMs} ms < 200ms, Err ${metrics.errorRatePct}%)`
      : `MELEBIHI SLA (${metrics.avgLatencyMs} ms, Err ${metrics.errorRatePct}%)`;
  }

  renderWorkerDistributionBars(distWrap, metrics.workerNodes, 'Tidak ada node worker yang merespons.');
}

function recordWarTestResult({ concertId, count, metrics }) {
  const selectEl = document.getElementById('stressConcertSelect');
  const optText = selectEl?.options?.[selectEl.selectedIndex]?.text || `Konser #${concertId}`;
  const entry = {
    id: `RUN-${Date.now().toString(36).toUpperCase()}`,
    timestamp: new Date().toISOString(),
    concertId,
    concertLabel: optText,
    totalRequests: Number(metrics.totalRequests || count),
    avgLatencyMs: Number(metrics.avgLatencyMs || 0),
    p95LatencyMs: Number(metrics.p95LatencyMs ?? metrics.avgLatencyMs ?? 0),
    ok200: Number(metrics.ok200 || 0),
    conflict409: Number(metrics.conflict409 || 0),
    error5xx: Number(metrics.error5xx || 0),
    errorRatePct: Number(metrics.errorRatePct || 0),
    slaPassed: Boolean(metrics.slaPassed),
    workerNodes: metrics.workerNodes || {},
  };

  state.warTestHistory.unshift(entry);
  if (state.warTestHistory.length > 20) state.warTestHistory.length = 20;
  try {
    sessionStorage.setItem('wartiket_war_test_history', JSON.stringify(state.warTestHistory));
  } catch {}
  renderHasilWarTestPage();
}

function renderHasilWarTestPage() {
  const latest = state.warTestHistory[0] || null;
  const subEl = document.getElementById('hasilSummarySubtitle');
  const badgeEl = document.getElementById('hasilLatestSlaBadge');
  const countEl = document.getElementById('hasilLatestCount');
  const latEl = document.getElementById('hasilLatestLatency');
  const outEl = document.getElementById('hasilLatestOutcomes');
  const errNodesEl = document.getElementById('hasilLatestErrorNodes');
  const distWrap = document.getElementById('hasilWorkerDist');
  const histWrap = document.getElementById('warTestHistoryWrap');

  if (!latest) {
    if (subEl) subEl.textContent = 'Belum ada hasil simulasi. Jalankan pengujian dari menu Live Test.';
    if (badgeEl) {
      badgeEl.classList.add('is-pass');
      badgeEl.classList.remove('is-fail');
      badgeEl.textContent = 'Belum Ada Data';
    }
    if (countEl) countEl.textContent = '0 req';
    if (latEl) latEl.textContent = '0 ms';
    if (outEl) outEl.textContent = '0 / 0';
    if (errNodesEl) errNodesEl.textContent = '0%';
    renderWorkerDistributionBars(distWrap, {}, 'Belum ada hasil pengujian tersimpan.');
    if (histWrap) {
      histWrap.innerHTML =
        '<div class="catalog-loading-state"><span>Belum ada riwayat pengujian. Buka menu <strong>Live Test</strong> lalu klik <strong>Mulai War Test</strong>.</span></div>';
    }
    return;
  }

  const nodeCount = Object.keys(latest.workerNodes || {}).length;
  if (subEl) {
    subEl.textContent = `Pengujian terakhir (${latest.concertLabel}) pada ${new Date(latest.timestamp).toLocaleString('id-ID')}.`;
  }
  if (badgeEl) {
    badgeEl.classList.toggle('is-pass', latest.slaPassed);
    badgeEl.classList.toggle('is-fail', !latest.slaPassed);
    badgeEl.textContent = latest.slaPassed
      ? `SLA TERPENUHI (${latest.avgLatencyMs} ms < 200ms)`
      : `MELEBIHI SLA (${latest.avgLatencyMs} ms)`;
  }
  if (countEl) countEl.textContent = `${latest.totalRequests} req`;
  if (latEl) latEl.textContent = `${latest.avgLatencyMs} / ${latest.p95LatencyMs} ms`;
  if (outEl) outEl.textContent = `${latest.ok200} / ${latest.conflict409}`;
  if (errNodesEl) errNodesEl.textContent = `${latest.errorRatePct}% (${nodeCount} node)`;
  renderWorkerDistributionBars(distWrap, latest.workerNodes, 'Tidak ada node worker tercatat.');

  if (histWrap) {
    histWrap.innerHTML = `
      <table class="orders-table">
        <thead>
          <tr>
            <th>Waktu</th>
            <th>Konser Target</th>
            <th>Request</th>
            <th>Avg / p95</th>
            <th>OK / 409</th>
            <th>Worker Node</th>
            <th>Status SLA</th>
          </tr>
        </thead>
        <tbody>
          ${state.warTestHistory
            .map((run) => {
              const dt = run.timestamp ? new Date(run.timestamp).toLocaleString('id-ID') : '-';
              const nodesSummary = Object.entries(run.workerNodes || {})
                .map(([n, c]) => `${n} (${c})`)
                .join(', ') || '-';
              const pillCls = run.slaPassed ? 'is-paid' : 'is-expired';
              const pillLabel = run.slaPassed ? 'PASS (<200ms)' : 'FAIL (>=200ms)';
              return `
                <tr>
                  <td style="font-size: 13px; color: var(--color-text-muted);">${escapeHtml(dt)}</td>
                  <td><strong>${escapeHtml(run.concertLabel)}</strong></td>
                  <td class="font-mono">${run.totalRequests}</td>
                  <td class="font-mono">${run.avgLatencyMs} / ${run.p95LatencyMs} ms</td>
                  <td class="font-mono">${run.ok200} / ${run.conflict409}</td>
                  <td class="font-mono" style="font-size: 12px;">${escapeHtml(nodesSummary)}</td>
                  <td><span class="status-pill ${pillCls}">${pillLabel}</span></td>
                </tr>
              `;
            })
            .join('')}
        </tbody>
      </table>
    `;
  }
}

function clearWarTestHistory({ silent = false } = {}) {
  state.warTestHistory = [];
  try {
    sessionStorage.removeItem('wartiket_war_test_history');
  } catch {}
  renderHasilWarTestPage();
  if (!silent) {
    showToast('Riwayat Hasil War Test dibersihkan.');
  }
}

async function runLiveStressTest() {
  if (state.isRunningStressTest) return;

  const count = parseInt(document.getElementById('stressCountSelect')?.value || '100', 10);
  const concertId = parseInt(document.getElementById('stressConcertSelect')?.value || '1', 10);
  const btn = document.getElementById('btnStartStressTest');

  state.isRunningStressTest = true;
  if (stressTestController) stressTestController.abort();
  stressTestController = new AbortController();

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="ui-spinner ui-spinner-light"></span><span>Mengirim ${count} Request...</span>`;
  }

  try {
    if (count <= 10) {
      // Browser direct concurrency burst for small counts (<= 10)
      const tasks = Array.from({ length: count }, async (_, idx) => {
        const t0 = performance.now();
        try {
          const res = await fetch('/api/tickets/buy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: idx + 6, concertId }),
            signal: stressTestController.signal,
          });
          const body = await res.json().catch(() => ({}));
          return { status: res.status, ms: performance.now() - t0, servedBy: body.servedBy || 'unknown' };
        } catch (err) {
          if (err.name === 'AbortError') throw err;
          return { status: 0, ms: performance.now() - t0, servedBy: 'error' };
        }
      });

      const items = await Promise.all(tasks);
      const sortedMs = items.map((r) => r.ms).sort((a, b) => a - b);
      const avg = sortedMs.reduce((s, v) => s + v, 0) / sortedMs.length;
      const p95 = sortedMs[Math.min(sortedMs.length - 1, Math.floor(sortedMs.length * 0.95))];
      const ok200 = items.filter((r) => r.status === 200).length;
      const conflict409 = items.filter((r) => r.status === 409).length;
      const error5xx = items.length - ok200 - conflict409;
      const errorRatePct = Number(((error5xx / items.length) * 100).toFixed(2));
      const workerNodes = {};
      for (const r of items) {
        if (r.servedBy && r.servedBy !== 'error') {
          workerNodes[r.servedBy] = (workerNodes[r.servedBy] || 0) + 1;
        }
      }
      const metricsPayload = {
        totalRequests: count,
        avgLatencyMs: Number(avg.toFixed(1)),
        p95LatencyMs: Number(p95.toFixed(1)),
        ok200,
        conflict409,
        error5xx,
        errorRatePct,
        slaPassed: avg < 200 && errorRatePct < 1,
        workerNodes,
      };
      renderStressTestMetrics(metricsPayload);
      recordWarTestResult({ concertId, count, metrics: metricsPayload });
      await refreshLiveTestQuota();
    } else {
      // In-cluster Nginx burst for 100-1000 requests (bypasses browser 6-socket cap)
      const burstTimeoutMs = Math.max(30000, count * 90);
      const { res, data } = await fetchJsonWithTimeout(
        '/api/stress-test/run',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ count, concertId, userId: state.currentUser?.id || 1 }),
          signal: stressTestController.signal,
        },
        burstTimeoutMs
      );
      if (!res.ok || !data.success) {
        throw new Error(data.message || `Gagal menjalankan stress test (HTTP ${res.status}).`);
      }
      renderStressTestMetrics(data);
      recordWarTestResult({ concertId, count, metrics: data });
      if (Array.isArray(data.concertQuotas) && data.concertQuotas.length > 0) {
        renderStressQuotaBadges(data.concertQuotas);
      } else {
        await refreshLiveTestQuota();
      }
    }

    state.concertsLoaded = false;
    showToast(`Simulasi ${count} concurrent requests selesai!`);
  } catch (err) {
    if (err.isExternalAbort || err.name === 'AbortError') return;
    showToast(`Gagal menjalankan stress test: ${err.message}`, true);
  } finally {
    state.isRunningStressTest = false;
    stressTestController = null;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span>Mulai War Test</span>';
    }
  }
}

// ============================================================================
// 12. SHARED OVERLAYS (MODALS, E-TICKET, MULTI-SELECT BAR, TOAST) & INIT
// ============================================================================

function ensureSharedModals() {
  if (!document.body || document.getElementById('modalRoot')) return;

  const root = document.createElement('div');
  root.id = 'modalRoot';
  root.className = 'modal-root';
  root.innerHTML = `
    <!-- Bar Multi-Konser Terpilih -->
    <div id="multiSelectBar" class="multi-select-bar" role="region" aria-label="Konser Terpilih">
      <div class="multi-select-info">
        <div class="multi-select-label"><span id="multiSelectCount">0</span> Konser Dipilih:</div>
        <div id="multiSelectChips" class="multi-select-chips"></div>
      </div>
      <div class="multi-select-actions">
        <button type="button" class="btn-multi-cancel" onclick="clearSelectedConcerts()">Batal</button>
        <button type="button" class="btn-multi-war" onclick="startMultiConcertWar()">War Terpilih Sekarang &rarr;</button>
      </div>
    </div>

    <!-- Modal Login Akun Konsumen -->
    <div id="loginModal" class="modal-overlay" role="dialog" aria-modal="true" aria-label="Login Akun">
      <div class="modal-card modal-card-sm">
        <button type="button" class="modal-close-btn" aria-label="Tutup Login" onclick="closeLoginModal()">&times;</button>

        <div class="modal-header-center">
          <h3 class="modal-title">Masuk ke Akun Anda</h3>
          <p class="modal-subtitle">Silakan masuk untuk melanjutkan pemilihan kursi dan pemesanan tiket resmi.</p>
        </div>

        <div id="loginGuardNotice" class="modal-notice-banner">
          Anda harus masuk akun terlebih dahulu sebelum memilih kursi dan mengikuti War Tiket.
        </div>

        <form class="modal-form" onsubmit="handleLogin(event)">
          <div class="form-group">
            <label class="form-label" for="modalLoginEmail">Alamat Email</label>
            <input type="email" id="modalLoginEmail" class="form-pill-input" required placeholder="nama@email.com" value="user@wartiket.id">
          </div>

          <div class="form-group">
            <label class="form-label" for="modalLoginPassword">Kata Sandi</label>
            <input type="password" id="modalLoginPassword" class="form-pill-input" required placeholder="Masukkan kata sandi" value="password123">
          </div>

          <button type="submit" id="btnLoginSubmit" class="btn-pill-primary modal-submit-btn">
            <span>Masuk Sekarang</span>
          </button>
        </form>

        <div class="demo-accounts-box">
          <div class="demo-accounts-header">
            <span class="demo-accounts-title">⚡ Akun Cepat Pengujian:</span>
            <span class="demo-accounts-badge">1-Klik Isi</span>
          </div>
          <div class="demo-accounts-grid">
            <button type="button" class="demo-account-btn" onclick="autoFill('admin@wartiket.id', 'password123')">
              <div class="demo-account-name">ADMIN</div>
              <div class="demo-account-email">admin@wartiket.id</div>
            </button>
            <button type="button" class="demo-account-btn" onclick="autoFill('user@wartiket.id', 'password123')">
              <div class="demo-account-name">USER</div>
              <div class="demo-account-email">user@wartiket.id</div>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal War Tiket (Kursi -> Data Diri -> E-Ticket) -->
    <div id="warModal" class="modal-overlay" role="dialog" aria-modal="true" aria-label="War Tiket">
      <div class="modal-card">
        <button type="button" class="modal-close-btn" aria-label="Tutup War Tiket" onclick="closeWarModal()">&times;</button>

        <div id="warConcertTabs" class="multi-tabs-bar"></div>

        <div class="modal-steps-bar">
          <div id="modalStep1" class="modal-step-item active">1. Pilih Kursi</div>
          <div id="modalStep2" class="modal-step-item">2. Data Diri</div>
          <div id="modalStep3" class="modal-step-item">3. E-Ticket</div>
        </div>
        <div id="warQueueStatusBar" class="queue-status-bar no-print" role="status" aria-live="polite"></div>
        <div id="warFeedbackBanner" class="modal-notice-banner no-print" role="alert" aria-live="assertive"></div>

        <div id="phaseQueueWaiting" style="display: none;">
          <div class="queue-waiting-card">
            <span class="ui-spinner ui-spinner-lg"></span>
            <h3 id="queueWaitingTitle" class="modal-title" style="font-size: 20px; line-height: 26px;">Menghubungkan ke Antrean Real-Time...</h3>
            <span id="queueTicketBadge" class="queue-position-badge">Nomor Antrean #-</span>
            <p class="modal-subtitle">Status tersinkronisasi di seluruh worker server. Halaman akan otomatis masuk ke peta kursi saat giliran Anda tiba.</p>
            <div class="queue-metrics-grid">
              <div class="queue-metric-box">
                <span class="queue-metric-label">Posisi Antrean</span>
                <span id="queuePositionVal" class="queue-metric-val">-</span>
              </div>
              <div class="queue-metric-box">
                <span class="queue-metric-label">Di Depan Anda</span>
                <span id="queueAheadVal" class="queue-metric-val">-</span>
              </div>
              <div class="queue-metric-box">
                <span class="queue-metric-label">Estimasi Tunggu</span>
                <span id="queueEtaVal" class="queue-metric-val">-</span>
              </div>
            </div>
            <div style="font-size: 12px; color: var(--color-text-muted);">Worker Node: <strong id="queueNodeVal" class="font-mono">-</strong></div>
            <div class="modal-actions-row" style="width: 100%; margin-top: 8px; justify-content: center;">
              <button type="button" id="btnRetryQueue" class="btn-pill-primary" style="display: none;" onclick="joinAndEnterWarQueue(state.activeWarConcertId)">
                <span>Masuk Antrean Ulang</span>
              </button>
              <button type="button" class="btn-pill-outline btn-pill-outline-dark" onclick="closeWarModal()">
                <span>Keluar Antrean</span>
              </button>
            </div>
          </div>
        </div>

        <div id="phaseSeatSelection">
          <div style="margin-bottom: 16px;">
            <h3 id="modalConcertTitle" class="modal-title" style="font-size: 22px; line-height: 28px;">Konser Pilihan</h3>
            <p id="modalConcertVenue" class="modal-subtitle" style="margin-top: 2px;">Venue Konser</p>
          </div>

          <div class="seat-stage-banner">PANGGUNG / STAGE UTAMA</div>
          <div id="modalSeatGrid" class="seat-grid-container"></div>

          <div class="modal-summary-box" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
            <div>
              <span class="demo-accounts-title" style="color: var(--color-text-muted); margin-bottom: 2px;">Kursi Terpilih</span>
              <span id="labelChosenSeat" style="font-weight: 800; color: var(--color-forest); font-size: 18px;">Belum Memilih</span>
            </div>
            <div style="text-align: right;">
              <span class="demo-accounts-title" style="color: var(--color-text-muted); margin-bottom: 2px;">Harga Tiket</span>
              <span id="labelChosenPrice" style="font-weight: 800; color: var(--color-forest); font-size: 18px;">Rp 0</span>
            </div>
          </div>

          <button type="button" id="btnProceedToData" class="btn-pill-primary" style="width: 100%;" disabled onclick="goToPhaseDataDiri()">
            <span>Lanjut ke Data Diri &rarr;</span>
          </button>
        </div>

        <div id="phaseDataDiri" style="display: none;">
          <div style="margin-bottom: 14px;">
            <h3 class="modal-title" style="font-size: 22px; line-height: 28px;">Data Pemesan &amp; Pembayaran</h3>
            <p class="modal-subtitle">Pastikan data sesuai kartu identitas (KTP/Paspor) untuk verifikasi pintu masuk venue.</p>
          </div>

          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label" for="buyerFullName">Nama Lengkap (Sesuai KTP)</label>
              <input type="text" id="buyerFullName" class="form-pill-input" placeholder="Nama Lengkap">
            </div>
            <div class="form-group">
              <label class="form-label" for="buyerEmailAddress">Alamat Email Penerima E-Ticket</label>
              <input type="email" id="buyerEmailAddress" class="form-pill-input" placeholder="nama@email.com">
            </div>
          </div>

          <div style="margin-top: 14px;">
            <label class="form-label" style="margin-bottom: 6px;">Pilih Metode Pembayaran</label>
            <div class="payment-methods-grid" id="paymentMethodsGrid">
              <label class="payment-method-card active" onclick="selectPaymentMethod('QRIS Instan (GoPay/OVO/ShopeePay/BCA)')">
                <input type="radio" name="paymentOption" value="QRIS" checked>
                <div class="payment-method-icon">&#128241;</div>
                <div class="payment-method-info">
                  <div class="payment-method-title">QRIS Instan</div>
                  <div class="payment-method-desc">GoPay, OVO, DANA, ShopeePay, BCA Mobile</div>
                </div>
                <div class="payment-method-badge">INSTAN</div>
              </label>

              <label class="payment-method-card" onclick="selectPaymentMethod('Virtual Account Bank (BCA / Mandiri / BNI / BRI)')">
                <input type="radio" name="paymentOption" value="Virtual Account">
                <div class="payment-method-icon">&#127974;</div>
                <div class="payment-method-info">
                  <div class="payment-method-title">Virtual Account (VA)</div>
                  <div class="payment-method-desc">Transfer Bank BCA, Mandiri, BNI, BRI</div>
                </div>
                <div class="payment-method-badge">OTOMATIS</div>
              </label>

              <label class="payment-method-card" onclick="selectPaymentMethod('Kartu Kredit / Debit (Visa / Mastercard)')">
                <input type="radio" name="paymentOption" value="Kartu Kredit">
                <div class="payment-method-icon">&#128179;</div>
                <div class="payment-method-info">
                  <div class="payment-method-title">Kartu Kredit / Debit Online</div>
                  <div class="payment-method-desc">Visa, Mastercard, JCB Terenkripsi 3D-Secure</div>
                </div>
              </label>
            </div>
          </div>

          <div class="modal-summary-box">
            <div class="modal-summary-row">
              <span>Konser:</span>
              <strong id="summaryConcertName">-</strong>
            </div>
            <div class="modal-summary-row">
              <span>Nomor Kursi:</span>
              <strong id="summarySeatCode" style="color: var(--color-forest);">-</strong>
            </div>
            <div class="modal-summary-row">
              <span>Metode Pembayaran:</span>
              <strong id="summaryPaymentMethod" style="color: var(--color-forest);">QRIS Instan (GoPay/OVO/ShopeePay/BCA)</strong>
            </div>
            <div class="modal-summary-row">
              <span>Biaya Layanan &amp; Pajak:</span>
              <span style="color: #15803d; font-weight: 700;">Rp 0 (Promo Termasuk)</span>
            </div>
            <div class="modal-summary-total">
              <span>Total Tagihan:</span>
              <span id="summaryTotalCost" style="color: var(--color-forest);">Rp 0</span>
            </div>
          </div>

          <div class="modal-actions-row">
            <button type="button" id="btnBackToSeat" class="btn-pill-outline btn-pill-outline-dark" onclick="backToPhaseSeat()">
              &larr; Ubah Kursi
            </button>
            <button type="button" id="btnBayarSekarang" class="btn-pill-primary" style="flex: 1;" onclick="executeCheckout()">
              <span>Bayar &amp; Amankan Tiket (War Tiket)</span>
            </button>
          </div>
        </div>

        <div id="phaseETicket" style="display: none;">
          <div class="eticket-screen-heading no-print">
            <h3 class="modal-title eticket-screen-title">E-Ticket Resmi Terbit</h3>
            <p class="modal-subtitle">Simpan atau cetak E-Ticket resmi ini sebagai bukti sah akses masuk venue konser.</p>
          </div>

          <div class="eticket-paper" id="eTicketPrintArea">
            <div class="eticket-header">
              <div class="eticket-brand-block">
                <div class="eticket-kicker">E-TICKET RESMI &bull; TIKET KONSER MUSIK</div>
                <div class="eticket-brand-title">SISTEM WAR TIKET KONSER MUSIK</div>
                <div class="eticket-order-row">
                  Booking Code / Order ID: <strong id="ticketCode" class="selectable-text font-mono">TRX-XXXX</strong>
                </div>
              </div>
              <div class="eticket-header-right">
                <span class="eticket-badge-paid">&#10003; LUNAS / CONFIRMED</span>
                <div class="eticket-worker-box no-print" style="opacity: 0.6; font-size: 10px;">
                  <span class="eticket-worker-label">Audit Node</span>
                  <span id="ticketHostId" class="font-mono selectable-text eticket-worker-id">swarm-worker</span>
                </div>
              </div>
            </div>

            <div class="eticket-body">
              <div class="eticket-grid">
                <div class="eticket-field">
                  <span class="eticket-label">Konser &amp; Lokasi</span>
                  <strong id="ticketConcert" class="eticket-value">-</strong>
                  <span id="ticketVenue" class="eticket-subvalue"></span>
                </div>
                <div class="eticket-field">
                  <span class="eticket-label">Nama Pemegang Tiket</span>
                  <strong id="ticketBuyer" class="eticket-value selectable-text">-</strong>
                </div>
                <div class="eticket-field">
                  <span class="eticket-label">Nomor Kursi &amp; Kategori</span>
                  <strong id="ticketSeat" class="eticket-value eticket-seat-value">-</strong>
                </div>
                <div class="eticket-field">
                  <span class="eticket-label">Total Pembayaran</span>
                  <strong id="ticketPrice" class="eticket-value eticket-price-value">-</strong>
                </div>
                <div class="eticket-field" style="grid-column: 1 / -1;">
                  <span class="eticket-label">Metode Pembayaran</span>
                  <strong id="ticketPaymentMethod" class="eticket-value" style="font-size: 13.5px; color: #15803d;">QRIS Instan</strong>
                </div>
              </div>

              <!-- Barcode & QR Visual Area -->
              <div class="eticket-barcode-box">
                <svg class="barcode-svg" viewBox="0 0 280 32" fill="currentColor">
                  <rect x="0" y="0" width="3" height="32"/>
                  <rect x="5" y="0" width="2" height="32"/>
                  <rect x="9" y="0" width="4" height="32"/>
                  <rect x="15" y="0" width="1" height="32"/>
                  <rect x="18" y="0" width="3" height="32"/>
                  <rect x="23" y="0" width="5" height="32"/>
                  <rect x="30" y="0" width="2" height="32"/>
                  <rect x="34" y="0" width="1" height="32"/>
                  <rect x="37" y="0" width="4" height="32"/>
                  <rect x="43" y="0" width="2" height="32"/>
                  <rect x="47" y="0" width="3" height="32"/>
                  <rect x="52" y="0" width="6" height="32"/>
                  <rect x="60" y="0" width="2" height="32"/>
                  <rect x="64" y="0" width="3" height="32"/>
                  <rect x="69" y="0" width="1" height="32"/>
                  <rect x="72" y="0" width="4" height="32"/>
                  <rect x="78" y="0" width="2" height="32"/>
                  <rect x="82" y="0" width="5" height="32"/>
                  <rect x="89" y="0" width="2" height="32"/>
                  <rect x="93" y="0" width="3" height="32"/>
                  <rect x="98" y="0" width="1" height="32"/>
                  <rect x="101" y="0" width="4" height="32"/>
                  <rect x="107" y="0" width="2" height="32"/>
                  <rect x="111" y="0" width="5" height="32"/>
                  <rect x="118" y="0" width="3" height="32"/>
                  <rect x="123" y="0" width="2" height="32"/>
                  <rect x="127" y="0" width="4" height="32"/>
                  <rect x="133" y="0" width="1" height="32"/>
                  <rect x="136" y="0" width="5" height="32"/>
                  <rect x="143" y="0" width="2" height="32"/>
                  <rect x="147" y="0" width="4" height="32"/>
                  <rect x="153" y="0" width="1" height="32"/>
                  <rect x="156" y="0" width="3" height="32"/>
                  <rect x="161" y="0" width="6" height="32"/>
                  <rect x="169" y="0" width="2" height="32"/>
                  <rect x="173" y="0" width="3" height="32"/>
                  <rect x="178" y="0" width="4" height="32"/>
                  <rect x="184" y="0" width="2" height="32"/>
                  <rect x="188" y="0" width="5" height="32"/>
                  <rect x="195" y="0" width="1" height="32"/>
                  <rect x="198" y="0" width="4" height="32"/>
                  <rect x="204" y="0" width="2" height="32"/>
                  <rect x="208" y="0" width="5" height="32"/>
                  <rect x="215" y="0" width="3" height="32"/>
                  <rect x="220" y="0" width="1" height="32"/>
                  <rect x="223" y="0" width="4" height="32"/>
                  <rect x="229" y="0" width="2" height="32"/>
                  <rect x="233" y="0" width="6" height="32"/>
                  <rect x="241" y="0" width="2" height="32"/>
                  <rect x="245" y="0" width="3" height="32"/>
                  <rect x="250" y="0" width="1" height="32"/>
                  <rect x="253" y="0" width="4" height="32"/>
                  <rect x="259" y="0" width="2" height="32"/>
                  <rect x="263" y="0" width="5" height="32"/>
                  <rect x="270" y="0" width="2" height="32"/>
                  <rect x="274" y="0" width="4" height="32"/>
                </svg>
                <div class="barcode-number">OFFICIAL VERIFIED ENTRY PASS &bull; SCAN AT GATE</div>
              </div>

              <div class="eticket-note" style="margin-top: 14px;">
                <span class="eticket-verify-badge">&#128274; VERIFIKASI RESMI</span>
                <span>Tunjukkan E-Ticket ini beserta kartu identitas (KTP/SIM/Paspor) asli di pintu masuk venue. Pintu dibuka 2 jam sebelum konser.</span>
              </div>
            </div>
          </div>

          <div class="modal-actions-row no-print eticket-actions">
            <button type="button" class="btn-pill-outline btn-pill-outline-dark" onclick="window.print()">
              Cetak / Simpan PDF
            </button>
            <button type="button" class="btn-pill-primary eticket-done-btn" onclick="closeWarModal()">
              Selesai &amp; Kembali ke Beranda
            </button>
          </div>
        </div>
      </div>
    </div>

    <div id="toastBox" class="toast-box" role="status"></div>
  `;
  document.body.appendChild(root);
}

function initGlobalOverlayHandlers() {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeNavAccountDropdown();
      closeLoginModal();
      closeWarModal();
      closeAllAutocompletes();
    }
  });

  ['loginModal', 'warModal'].forEach((id) => {
    const overlay = document.getElementById(id);
    if (!overlay) return;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        if (id === 'loginModal') closeLoginModal();
        else if (id === 'warModal') closeWarModal();
      }
    });
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-field-pill')) {
      closeAllAutocompletes();
    }
    if (!e.target.closest('#navbar')) {
      closeNavAccountDropdown();
    }
  });

  ['cityFilter', 'dateFilter'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => {
      readSearchInputs();
      if (isConcertsPage()) {
        applyFilters({ syncUrl: true });
      }
    });
  });
}

async function syncSharedSession() {
  if (!state.currentUser) return;
  try {
    const res = await fetch('/api/auth/session', { cache: 'no-store' });
    if (res.status === 401) return;
    if (res.ok) {
      const data = await res.json();
      if (data.authenticated && data.user) {
        state.currentUser = data.user;
        sessionStorage.setItem('wartiket_user', JSON.stringify(data.user));
        updateAuthUI();
      }
    }
  } catch (e) {}
}

window.addEventListener('DOMContentLoaded', () => {
  ensureSharedModals();
  initSpaNavigation();
  updateAuthUI();
  syncSharedSession();
  pollHealth();
  setInterval(pollHealth, 5000);

  populateFilterDropdowns();
  attachAutocomplete('searchInput', 'searchAutocomplete');
  initGlobalOverlayHandlers();

  const initialPage = resolvePageFromLocation();
  switchPage(initialPage, {
    updateHash: Boolean(window.location.hash),
    scrollToTop: false,
  });

  requestAnimationFrame(() => {
    document.documentElement.classList.remove('wt-booting');
  });
});
