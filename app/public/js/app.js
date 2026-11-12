// SISTEM WAR TIKET KONSER MUSIK - Frontend UI Controller (Multi-Page Architecture)
// Fixed 1440px Scaled Stage + Navbar Paten di Atas + Shared Overlays + E-Ticket Print.

// ============================================================================
// 1. ZOOM & STAGE SCALING (KUNCI TAMPILAN DI SEMUA ZOOM 25% - 500%)
// ============================================================================

const DESIGN_W = 1440;
let activeScale = 1;
let lastFitSignature = '';
var stateReady = false;

function getScale() {
  return activeScale;
}

function isMobileViewport() {
  if (typeof window === 'undefined') return false;
  const cw = document.documentElement.clientWidth;
  const sw = window.screen?.width || cw;
  const ow = window.outerWidth || sw;
  const isTouchPrimary = Boolean(window.matchMedia?.('(hover: none) and (pointer: coarse)').matches);
  const isNarrowWindow = cw <= 768 && (sw <= 768 || ow <= 820);
  return (isTouchPrimary && cw <= 1024) || isNarrowWindow;
}

function fit() {
  const stage = document.getElementById('stage');
  if (!stage) return;

  const cw = document.documentElement.clientWidth || DESIGN_W;
  const ch = document.documentElement.clientHeight || 900;
  const mobile = isMobileViewport();
  const navbar = document.getElementById('top-navbar');
  const spaMain = document.getElementById('spaMain');

  if (mobile && navbar && spaMain && navbar.offsetHeight > 0) {
    const nextPad = `${navbar.offsetHeight + 12}px`;
    if (spaMain.style.paddingTop !== nextPad) spaMain.style.paddingTop = nextPad;
  }

  const nextSig = `${mobile ? 'm' : 'd'}:${cw}:${ch}`;
  if (nextSig === lastFitSignature && stateReady) return;
  lastFitSignature = nextSig;

  document.documentElement.classList.toggle('wt-mobile', mobile);
  document.body?.classList.toggle('is-mobile', mobile);

  const modalRoot = document.getElementById('modalRoot');
  if (mobile) {
    activeScale = 1;
    document.documentElement.style.setProperty('--s', '1');
    document.documentElement.style.setProperty('--boot-zoom', '1');
    document.documentElement.style.setProperty('--vp-h', `${Math.ceil(ch)}px`);
    stage.style.zoom = '';
    stage.style.transform = '';
    if (spaMain && navbar && navbar.offsetHeight > 0) {
      spaMain.style.paddingTop = `${navbar.offsetHeight + 12}px`;
    }
    document.body.style.height = '';
    if (modalRoot) modalRoot.style.transform = '';
  } else {
    const s = cw / DESIGN_W;
    activeScale = s;
    document.documentElement.style.setProperty('--s', String(s));
    document.documentElement.style.setProperty('--boot-zoom', String(s));
    document.documentElement.style.setProperty('--vp-h', `${Math.ceil(ch / s)}px`);

    // Modal root berskala mengikuti stage; #top-navbar murni fixed 100% tanpa transform agar konteks fixed tetap paten
    if (modalRoot) modalRoot.style.transform = `scale(${s})`;
    if (spaMain) spaMain.style.paddingTop = '';

    if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('zoom', '1')) {
      stage.style.zoom = String(s);
      stage.style.transform = '';
      document.body.style.height = '';
    } else {
      stage.style.zoom = '';
      stage.style.transform = `scale(${s})`;
      document.body.style.height = `${stage.scrollHeight * s}px`;
    }
  }

  const nextPerPage = mobile ? 1 : 3;
  if (stateReady && state.cardsPerPage !== nextPerPage) {
    state.cardsPerPage = nextPerPage;
    state.currentPage = 0;
    if (state.activePage === 'konser' && state.allConcerts.length > 0) renderCarousel();
  }
}

fit();
['resize', 'load'].forEach((ev) => addEventListener(ev, fit));
visualViewport?.addEventListener('resize', fit);

// Lapisan tambahan: cegah shortcut zoom Ctrl+scroll & Ctrl+/-/0 di halaman
window.addEventListener(
  'wheel',
  (e) => {
    if (e.ctrlKey) e.preventDefault();
  },
  { passive: false }
);

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '0', '_'].includes(e.key)) {
    e.preventDefault();
  }
});

// ============================================================================
// 2. APPLICATION STATE & SAMPLE CONCERT FALLBACK DATA (12 KONSER / 4 HALAMAN)
// ============================================================================

const SAMPLE_CONCERTS = [
  {
    id: 4,
    title: 'Bruno Mars - 24K Magic Live in Jakarta',
    artist: 'Bruno Mars',
    venue: 'Jakarta International Stadium (JIS), Jakarta',
    city: 'Jakarta',
    concertDate: '12 Maret 2027, 20:00 WIB',
    price: 1850000,
    totalSeats: 500,
    availableSeats: 412,
    imageUrl: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=900&q=80',
    isSample: true,
  },
  {
    id: 5,
    title: 'Tulus - Tur Manusia Bandung',
    artist: 'Tulus',
    venue: 'Eldorado Dome, Bandung',
    city: 'Bandung',
    concertDate: '25 Maret 2027, 19:30 WIB',
    price: 650000,
    totalSeats: 400,
    availableSeats: 280,
    imageUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=900&q=80',
    isSample: true,
  },
  {
    id: 6,
    title: 'Hindia & Feast - Malam Alternatif Nusantara',
    artist: 'Hindia & .Feast',
    venue: 'Jatim Expo Convention Hall, Surabaya',
    city: 'Surabaya',
    concertDate: '04 April 2027, 19:00 WIB',
    price: 450000,
    totalSeats: 450,
    availableSeats: 319,
    imageUrl: 'https://images.unsplash.com/photo-1524368535928-5b5e00ddc76b?auto=format&fit=crop&w=900&q=80',
    isSample: true,
  },
  {
    id: 7,
    title: 'Raisa - Symphony of Love Live Concert',
    artist: 'Raisa',
    venue: 'Indonesia Convention Exhibition (ICE) BSD, Tangerang',
    city: 'Jakarta',
    concertDate: '18 April 2027, 19:30 WIB',
    price: 900000,
    totalSeats: 500,
    availableSeats: 388,
    imageUrl: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=900&q=80',
    isSample: true,
  },
  {
    id: 8,
    title: 'Dewa 19 Featuring Virzha - Pesta Rakyat',
    artist: 'Dewa 19',
    venue: 'Stadion Gelora Bung Tomo, Surabaya',
    city: 'Surabaya',
    concertDate: '02 Mei 2027, 19:30 WIB',
    price: 550000,
    totalSeats: 600,
    availableSeats: 470,
    imageUrl: 'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?auto=format&fit=crop&w=900&q=80',
    isSample: true,
  },
  {
    id: 9,
    title: 'NIKI - Buzz World Tour Indonesia',
    artist: 'NIKI',
    venue: 'Beach City International Stadium, Jakarta',
    city: 'Jakarta',
    concertDate: '16 Mei 2027, 20:00 WIB',
    price: 1350000,
    totalSeats: 500,
    availableSeats: 245,
    imageUrl: 'https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?auto=format&fit=crop&w=900&q=80',
    isSample: true,
  },
  {
    id: 10,
    title: 'Prambanan Jazz Festival Heritage Edition',
    artist: 'Various Jazz Artists',
    venue: 'Candi Prambanan Open Stage, Yogyakarta',
    city: 'Yogyakarta',
    concertDate: '29 Mei 2027, 17:00 WIB',
    price: 800000,
    totalSeats: 550,
    availableSeats: 405,
    imageUrl: 'https://images.unsplash.com/photo-1429962714451-bb934ecdc4ec?auto=format&fit=crop&w=900&q=80',
    isSample: true,
  },
  {
    id: 11,
    title: 'Maliq & D Essentials - Groove Under The Stars',
    artist: 'Maliq & D Essentials',
    venue: 'GWK Cultural Park, Bali',
    city: 'Bali',
    concertDate: '12 Juni 2027, 18:30 WITA',
    price: 700000,
    totalSeats: 400,
    availableSeats: 350,
    imageUrl: 'https://images.unsplash.com/photo-1501612780327-45045538702b?auto=format&fit=crop&w=900&q=80',
    isSample: true,
  },
  {
    id: 12,
    title: 'Ed Sheeran - Mathematics Acoustic Night',
    artist: 'Ed Sheeran',
    venue: 'Trans Studio Convention Center, Bandung',
    city: 'Bandung',
    concertDate: '26 Juni 2027, 19:30 WIB',
    price: 1650000,
    totalSeats: 500,
    availableSeats: 295,
    imageUrl: 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=900&q=80',
    isSample: true,
  },
];

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
      isSample: Boolean(c.isSample),
    }));

    // Tambahkan data contoh jika kurang dari 10 konser agar carousel 4 halaman dapat diuji
    if (merged.length < 10) {
      const existingIds = new Set(merged.map((c) => c.id));
      for (const sample of SAMPLE_CONCERTS) {
        if (!existingIds.has(sample.id)) {
          merged.push({
            ...sample,
            dateLabel: extractDateLabel(sample.concertDate),
          });
        }
      }
    }

    state.allConcerts = merged;
    state.concertsLoaded = true;
    populateFilterDropdowns();

    // Hanya render carousel jika user memang sedang berada di halaman Konser
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
    : (state.allConcerts.length > 0
      ? state.allConcerts
      : [
          { city: 'Jakarta', dateLabel: '15 Desember 2026' },
          { city: 'Jakarta', dateLabel: '20 Januari 2027' },
          { city: 'Jakarta', dateLabel: '28 Februari 2027' },
          ...SAMPLE_CONCERTS.map((c) => ({ ...c, dateLabel: extractDateLabel(c.concertDate) })),
        ]);
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

function getTotalPages() {
  return Math.max(1, Math.ceil(state.filteredConcerts.length / state.cardsPerPage));
}

function renderCarousel() {
  const track = document.getElementById('carouselTrack');
  const viewport = document.getElementById('carouselViewport');
  const controls = document.getElementById('carouselControls');
  const emptyState = document.getElementById('emptySearchState');
  const dotsWrap = document.getElementById('carouselDots');
  if (!track || !viewport || !controls || !emptyState || !dotsWrap) return;

  const list = state.filteredConcerts;
  if (list.length === 0) {
    track.innerHTML = '';
    viewport.style.display = 'none';
    controls.style.display = 'none';
    emptyState.classList.add('active');
    fit();
    return;
  }

  emptyState.classList.remove('active');
  viewport.style.display = 'block';
  controls.style.display = 'flex';

  const totalPages = getTotalPages();
  if (state.currentPage >= totalPages) state.currentPage = Math.max(0, totalPages - 1);

  const pages = [];
  for (let i = 0; i < list.length; i += state.cardsPerPage) {
    pages.push(list.slice(i, i + state.cardsPerPage));
  }

  track.innerHTML = pages
    .map(
      (pageItems) =>
        `<div class="carousel-page">${pageItems
          .map((c) => renderConcertCardHtml(c, state.searchQuery))
          .join('')}</div>`
    )
    .join('');

  dotsWrap.innerHTML = Array.from({ length: totalPages }, (_, idx) => {
    const isActive = idx === state.currentPage;
    return `<button type="button" class="dot ${isActive ? 'active' : ''}" role="tab" aria-selected="${isActive}" aria-label="Halaman ${idx + 1}" onclick="goToCarouselPage(${idx})"></button>`;
  }).join('');

  updateCarouselPosition(false);
  fit();
}

function updateCarouselPosition(dragDeltaPx = false) {
  const viewport = document.getElementById('carouselViewport');
  const track = document.getElementById('carouselTrack');
  const prevBtn = document.getElementById('carouselPrevBtn');
  const nextBtn = document.getElementById('carouselNextBtn');
  const dots = document.querySelectorAll('#carouselDots .dot');

  const totalPages = getTotalPages();
  const pageWidth = viewport && viewport.clientWidth > 0 ? viewport.clientWidth : 1380;
  const baseOffset = -state.currentPage * pageWidth;

  if (track) {
    if (typeof dragDeltaPx === 'number') {
      track.classList.add('is-dragging');
      track.style.transform = `translateX(${baseOffset + dragDeltaPx}px)`;
    } else {
      track.classList.remove('is-dragging');
      track.style.transform = `translateX(${baseOffset}px)`;
    }
  }

  if (prevBtn) prevBtn.disabled = state.currentPage <= 0;
  if (nextBtn) nextBtn.disabled = state.currentPage >= totalPages - 1;

  dots.forEach((dot, idx) => {
    const active = idx === state.currentPage;
    dot.classList.toggle('active', active);
    dot.setAttribute('aria-selected', String(active));
  });
}

function goToCarouselPage(pageIdx) {
  const maxPage = getTotalPages() - 1;
  state.currentPage = Math.max(0, Math.min(pageIdx, maxPage));
  updateCarouselPosition(false);
}

function prevCarouselPage() {
  if (state.currentPage > 0) goToCarouselPage(state.currentPage - 1);
}

function nextCarouselPage() {
  if (state.currentPage < getTotalPages() - 1) goToCarouselPage(state.currentPage + 1);
}

// Carousel Pointer/Touch Drag (dibagi --s agar akurat) & Keyboard Controls
function initCarouselInteractions() {
  const viewport = document.getElementById('carouselViewport');
  if (!viewport) return;

  let isDragging = false;
  let startX = 0;
  let currentDelta = 0;

  function onStart(clientX, target) {
    if (target.closest('button, input, label, a, select')) return;
    isDragging = true;
    startX = clientX;
    currentDelta = 0;
  }

  function onMove(clientX) {
    if (!isDragging) return;
    const scale = getScale();
    let dx = (clientX - startX) / scale;
    const maxPage = getTotalPages() - 1;
    // Tambah tahanan di ujung karena tanpa loop
    if ((state.currentPage === 0 && dx > 0) || (state.currentPage === maxPage && dx < 0)) {
      dx *= 0.25;
    }
    currentDelta = dx;
    updateCarouselPosition(currentDelta);
  }

  function onEnd() {
    if (!isDragging) return;
    isDragging = false;
    const threshold = 80;
    const maxPage = getTotalPages() - 1;

    if (currentDelta <= -threshold && state.currentPage < maxPage) {
      state.currentPage += 1;
    } else if (currentDelta >= threshold && state.currentPage > 0) {
      state.currentPage -= 1;
    }
    currentDelta = 0;
    updateCarouselPosition(false);
  }

  viewport.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    onStart(e.clientX, e.target);
  });
  window.addEventListener('mousemove', (e) => onMove(e.clientX));
  window.addEventListener('mouseup', onEnd);

  viewport.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length === 1) onStart(e.touches[0].clientX, e.target);
    },
    { passive: true }
  );
  viewport.addEventListener(
    'touchmove',
    (e) => {
      if (isDragging && e.touches.length === 1) onMove(e.touches[0].clientX);
    },
    { passive: true }
  );
  viewport.addEventListener('touchend', onEnd);

  // Navigasi keyboard panah kiri/kanan (khusus saat halaman Konser aktif & modal tertutup)
  window.addEventListener('keydown', (e) => {
    if (!isConcertsPage()) return;
    const activeTag = document.activeElement?.tagName;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(activeTag)) return;
    if (document.querySelector('.modal-overlay.active')) return;
    if (e.key === 'ArrowLeft') {
      prevCarouselPage();
    } else if (e.key === 'ArrowRight') {
      nextCarouselPage();
    }
  });
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

const VALID_SPA_PAGES = ['beranda', 'konser', 'riwayat', 'kontak', 'live-test', 'hasil-war'];
let ordersAbortController = null;
let stressTestController = null;

function normalizePageKey(input) {
  const cleaned = String(input || '').replace(/^#\/?/, '').replace(/^page-/, '').toLowerCase();
  if (cleaned === 'hasil-test') return 'hasil-war';
  return VALID_SPA_PAGES.includes(cleaned) ? cleaned : 'beranda';
}

function resolvePageFromLocation() {
  const hash = (window.location.hash || '').replace(/^#\/?/, '').replace(/^page-/, '').toLowerCase();
  if (hash === 'hasil-test') return 'hasil-war';
  if (VALID_SPA_PAGES.includes(hash)) return hash;

  const path = (window.location.pathname || '/').toLowerCase().replace(/\/+$/, '') || '/';
  if (path === '/konser' || path === '/concerts.html') return 'konser';
  if (path === '/riwayat') return 'riwayat';
  if (path === '/kontak' || path === '/contact.html') return 'kontak';
  if (path === '/live-test') return 'live-test';
  if (path === '/hasil-test' || path === '/hasil-war') return 'hasil-war';
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
  const expectedTarget = `page-${activeKey}`;
  document.querySelectorAll('.nav-link[data-target], .nav-link[data-page]').forEach((link) => {
    const linkKey = normalizePageKey(link.dataset.target || link.dataset.page);
    const isCurrent = link.dataset.target === expectedTarget || linkKey === activeKey;
    link.classList.toggle('active', isCurrent);
    if (isCurrent) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

/**
 * Centralized SPA router: stops booking countdown timers, hides all `.page-section`
 * elements via `.hidden`, reveals the target section, syncs `.active`, and resets scroll.
 */
function switchPage(targetPageId, { updateHash = true, scrollToTop = true, forceRefresh = false } = {}) {
  const targetPage = normalizePageKey(targetPageId);

  closeNavAccountDropdown();
  closeAllAutocompletes();

  // Hentikan timer/polling pemesanan tiket & batalkan fetch tertunda saat berpindah halaman
  stopTicketBookingTimers(targetPage);

  state.activePage = targetPage;
  document.documentElement.setAttribute('data-active-page', targetPage);

  // Sembunyikan seluruh section halaman dengan .hidden secara instan dan tampilkan target
  document.querySelectorAll('.page-section').forEach((section) => {
    const isTarget = section.id === `page-${targetPage}` || section.dataset.pageSection === targetPage;
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
      updateCarouselPosition(false);
    }
  } else if (targetPage === 'riwayat') {
    fetchMyOrders();
  } else if (targetPage === 'live-test') {
    refreshLiveTestQuota();
  } else if (targetPage === 'hasil-war') {
    renderHasilWarTestPage();
  }

  fit();
  if (scrollToTop) {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }
}

const navigateTo = switchPage;
window.switchPage = switchPage;
window.navigateTo = switchPage;

function initSpaNavigation() {
  document.addEventListener('click', (e) => {
    const navTarget = e.target.closest('a[data-target], a[data-page]');
    if (!navTarget) return;
    e.preventDefault();
    const targetPage = navTarget.dataset.target || navTarget.dataset.page || navTarget.getAttribute('href') || 'page-beranda';
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

let pendingLogoutPromise = null;

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
    if (pendingLogoutPromise) await pendingLogoutPromise;
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

    if (state.activePage === 'riwayat') {
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
  pendingLogoutPromise = fetch('/api/auth/logout', { method: 'POST', keepalive: true })
    .catch(() => {})
    .finally(() => {
      pendingLogoutPromise = null;
    });
  updateAuthUI();
  closeNavAccountDropdown();
  closeWarModal();
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
let seatHoldTimer = null;
let seatHoldDeadlineMs = 0;

function stopSeatHoldTimer() {
  if (seatHoldTimer) {
    clearInterval(seatHoldTimer);
    seatHoldTimer = null;
  }
  seatHoldDeadlineMs = 0;
}

function formatHoldClock(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function startSeatHoldTimer(expiresInSec = 180) {
  stopSeatHoldTimer();
  const initialSec = Math.max(30, Number(expiresInSec) || 180);
  seatHoldDeadlineMs = Date.now() + initialSec * 1000;
  const tick = () => {
    const el = document.getElementById('warSeatHoldCountdown');
    if (!el || !document.getElementById('warModal')?.classList.contains('active')) {
      stopSeatHoldTimer();
      return;
    }
    const remSec = Math.max(0, Math.ceil((seatHoldDeadlineMs - Date.now()) / 1000));
    el.textContent = `Hold ${formatHoldClock(remSec)}`;
    if (remSec <= 0) {
      stopSeatHoldTimer();
      state.selectedSeat = null;
      renderSeats();
      showWarFeedback('Batas waktu tahan kursi habis. Silakan pilih kursi atau masuk antrean ulang.');
    }
  };
  tick();
  seatHoldTimer = setInterval(tick, 1000);
}

function stopQueuePolling() {
  stopSeatHoldTimer();
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
    const holdSec = Math.max(30, Number(q.expiresInSec) || 180);
    bar.classList.add('active');
    bar.classList.toggle('is-waiting', isQueued);
    bar.innerHTML = `
      <span class="queue-status-left">
        <span class="${isQueued ? 'ui-spinner' : 'dot-online'}"></span>
        <span>${isQueued ? `Dalam Antrean (Tiket ${ticketLabel})` : `Giliran Anda (${ticketLabel}) • Silakan Pilih Kursi`}</span>
      </span>
      <span class="queue-status-meta">
        ${isQueued ? '' : `<strong id="warSeatHoldCountdown" class="font-mono" style="margin-right: 10px;">Hold ${formatHoldClock(holdSec)}</strong> • `}Node: ${escapeHtml(q.servedBy || state.lastWorkerHost)}
      </span>
    `;
    if (isQueued) {
      stopSeatHoldTimer();
    } else {
      startSeatHoldTimer(holdSec);
    }
  } else if (bar) {
    stopSeatHoldTimer();
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
    // Konser sampel tambahan (id > 3) diproses tanpa merusak kuota DB konser utama 1-3
    if (state.selectedConcert?.isSample) {
      if (state.selectedSeat.status === 'Booked' || state.selectedSeat.status === 'Locked') {
        showWarFeedback('Kursi ini sudah diamankan. Silakan pilih kursi lain.');
        showToast('Kursi sudah diamankan. Silakan pilih kursi lain.', true);
        state.isCheckingOut = false;
        backToPhaseSeat();
        renderSeats();
        return;
      }

      await pollHealth();
      const orderId = `TRX-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      state.selectedSeat.status = 'Booked';
      state.selectedConcert.availableSeats = Math.max(0, Number(state.selectedConcert.availableSeats || 1) - 1);

      displayETicket(
        {
          orderId,
          concert: state.selectedConcert,
          user: state.currentUser,
          seat: state.selectedSeat,
          amount: Number(state.selectedSeat?.price || state.selectedConcert.price || 0),
        },
        state.lastWorkerHost
      );
      renderCarousel();
      return;
    }

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
  stopSeatHoldTimer();
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
  root.className = 'scaled-overlay-root';
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

    <!-- Modal Login Akun Demo -->
    <div id="loginModal" class="modal-overlay" role="dialog" aria-modal="true" aria-label="Login Akun">
      <div class="modal-card modal-card-sm">
        <button type="button" class="modal-close-btn" aria-label="Tutup Login" onclick="closeLoginModal()">&times;</button>

        <div class="modal-header-center">
          <h3 class="modal-title">Masuk ke Sistem</h3>
          <p class="modal-subtitle">Pilih salah satu Akun Demo atau ketik kredensial Anda</p>
        </div>

        <div id="loginGuardNotice" class="modal-notice-banner">
          Anda harus masuk akun terlebih dahulu sebelum memilih kursi dan mengikuti War Tiket.
        </div>

        <div class="demo-accounts-box">
          <span class="demo-accounts-title">Pilih Akun Demo (1-Klik):</span>
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

        <form class="modal-form" onsubmit="handleLogin(event)">
          <div>
            <label class="form-label" for="modalLoginEmail">Alamat Email</label>
            <input type="email" id="modalLoginEmail" class="form-pill-input" required value="admin@wartiket.id">
          </div>

          <div>
            <label class="form-label" for="modalLoginPassword">Password</label>
            <input type="password" id="modalLoginPassword" class="form-pill-input" required value="password123">
          </div>

          <button type="submit" id="btnLoginSubmit" class="btn-pill-primary" style="width: 100%; margin-top: 8px;">
            <span>Masuk Sekarang</span>
          </button>
        </form>
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
          <div style="margin-bottom: 18px;">
            <h3 class="modal-title" style="font-size: 22px; line-height: 28px;">Konfirmasi Pemesanan</h3>
            <p class="modal-subtitle">Data terisi otomatis dari akun login Anda untuk kecepatan war tiket.</p>
          </div>

          <div class="form-grid-2">
            <div>
              <label class="form-label" for="buyerFullName">Nama Lengkap</label>
              <input type="text" id="buyerFullName" class="form-pill-input" style="padding: 10px 14px; font-size: 14px;">
            </div>
            <div>
              <label class="form-label" for="buyerEmailAddress">Alamat Email</label>
              <input type="email" id="buyerEmailAddress" class="form-pill-input" style="padding: 10px 14px; font-size: 14px;">
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
            <h3 class="modal-title eticket-screen-title">E-Ticket Resmi</h3>
          </div>

          <div class="eticket-paper" id="eTicketPrintArea">
            <div class="eticket-header">
              <div class="eticket-brand-block">
                <div class="eticket-kicker">E-TICKET RESMI</div>
                <div class="eticket-brand-title">SISTEM WAR TIKET KONSER MUSIK</div>
                <div class="eticket-order-row">
                  Order ID: <strong id="ticketCode" class="selectable-text font-mono">TRX-XXXX</strong>
                </div>
              </div>
              <div class="eticket-header-right">
                <span class="eticket-badge-paid">PEMBAYARAN LUNAS</span>
                <div class="eticket-worker-box no-print">
                  <span class="eticket-worker-label">Worker Host</span>
                  <span id="ticketHostId" class="font-mono selectable-text eticket-worker-id">swarm-worker</span>
                </div>
              </div>
            </div>

            <div class="eticket-body">
              <div class="eticket-grid">
                <div class="eticket-field">
                  <span class="eticket-label">Detail Konser</span>
                  <strong id="ticketConcert" class="eticket-value">-</strong>
                  <span id="ticketVenue" class="eticket-subvalue"></span>
                </div>
                <div class="eticket-field">
                  <span class="eticket-label">Nama Penonton</span>
                  <strong id="ticketBuyer" class="eticket-value selectable-text">-</strong>
                </div>
                <div class="eticket-field">
                  <span class="eticket-label">Nomor Kursi</span>
                  <strong id="ticketSeat" class="eticket-value eticket-seat-value">-</strong>
                </div>
                <div class="eticket-field">
                  <span class="eticket-label">Total Bayar</span>
                  <strong id="ticketPrice" class="eticket-value eticket-price-value">-</strong>
                </div>
              </div>

              <div class="eticket-note">
                <span class="eticket-verify-badge">STATUS: TERVERIFIKASI</span>
                <span>Tiket terverifikasi valid secara atomic di Redis &amp; PostgreSQL. Harap tunjukkan saat masuk venue.</span>
              </div>
            </div>
          </div>

          <div class="modal-actions-row no-print eticket-actions">
            <button type="button" class="btn-pill-outline btn-pill-outline-dark" onclick="window.print()">
              Cetak / PDF
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
    if (!e.target.closest('#top-navbar')) {
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

  initCarouselInteractions();
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
