/* ==========================================================================
   THE ROYALS — main.js
   All site interactivity. Vanilla ES2018+, no dependencies.
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------
     Brand-wide constants
     ------------------------------------------------------------------ */
  var BRAND = {
    name: 'The Royals',
    tz: 'Asia/Dubai',   // GST, UTC+4, no daylight saving anywhere in the UAE
    menuPage: 'menu.html'
  };

  /* ------------------------------------------------------------------
     LOCATIONS — the single source of truth for every venue.

     Everything that differs between branches lives here: phone, WhatsApp,
     door times, last entry, metro, parking and the map pin. Add another
     object to this array and the whole site becomes multi-branch on its
     own: the picker appears in the header, drawer, contact page and
     booking form, the open/closed clock follows the chosen venue, and
     the reservation goes to that branch's WhatsApp. Nothing else to edit.

     To add a branch, copy the block below and fill in real details:

       {
         id: 'deira',                       // url-safe, must be unique
         name: 'Deira',                     // short label for the picker
         venue: 'Hotel name',
         address: ['Hotel name', 'Street, Area', 'Dubai, UAE'],
         mapQuery: 'Hotel name Deira Dubai',
         phone: '+971 5X XXX XXXX',
         phoneRaw: '+9715XXXXXXXX',
         whatsapp: '9715XXXXXXXX',
         open: { hour: 21, minute: 0 },
         close: { hour: 4, minute: 0 },
         lastEntry: '3:00 AM',
         metro: 'Station name', metroLine: 'Green Line',
         metroWalk: 'about a five-minute walk',
         parking: 'Valet available'
       }
     ------------------------------------------------------------------ */
  var LOCATIONS = [
    {
      id: 'al-barsha',
      name: 'Al Barsha',
      venue: 'Grand Excelsior Hotel',
      address: ['Grand Excelsior Hotel', '60th Street, Al Barsha 1', 'Dubai, UAE'],
      mapQuery: 'Grand Excelsior Hotel Al Barsha Dubai',
      phone: '+971 54 292 1626',
      phoneRaw: '+971542921626',
      whatsapp: '971542921626',
      open:  { hour: 21, minute: 0 },   // 9:00 PM
      close: { hour: 4,  minute: 0 },   // 4:00 AM, next day
      lastEntry: '3:00 AM',
      metro: 'Mall of the Emirates',
      metroLine: 'Red Line',
      metroWalk: 'about a ten-minute walk',
      parking: 'Free on-site parking'
    }
  ];

  var LOC_KEY = 'tr-location';

  function locationById(id) {
    for (var i = 0; i < LOCATIONS.length; i++) {
      if (LOCATIONS[i].id === id) return LOCATIONS[i];
    }
    return null;
  }

  /* The branch the visitor is currently looking at. Remembered per browser. */
  function currentLocation() {
    var saved = null;
    try { saved = localStorage.getItem(LOC_KEY); } catch (e) {}
    return locationById(saved) || LOCATIONS[0];
  }

  function setLocation(id) {
    if (!locationById(id)) return;
    try { localStorage.setItem(LOC_KEY, id); } catch (e) {}
    document.dispatchEvent(new CustomEvent('location:change', { detail: { id: id } }));
  }

  var multiSite = LOCATIONS.length > 1;

  /* Door times as minutes past midnight, for the branch in view. */
  function openMinutes(loc)  { loc = loc || currentLocation(); return loc.open.hour * 60 + loc.open.minute; }
  function closeMinutes(loc) { loc = loc || currentLocation(); return loc.close.hour * 60 + loc.close.minute; }

  function hoursLabel(loc) {
    loc = loc || currentLocation();
    return time12(loc.open.hour, loc.open.minute) + ' – ' + time12(loc.close.hour, loc.close.minute);
  }

  function time12(h, m) {
    var suffix = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12 || 12;
    return h12 + ':' + pad(m) + ' ' + suffix;
  }

  function mq(query) {
    try { return !!(window.matchMedia && window.matchMedia(query).matches); }
    catch (e) { return false; }
  }
  var reduceMotion = mq('(prefers-reduced-motion: reduce)');
  var isTouch = mq('(hover: none), (pointer: coarse)') || 'ontouchstart' in window;

  /* Runs a feature in isolation: one broken feature must never disable the rest. */
  function safe(name, fn) {
    try { fn(); } catch (e) {
      if (window.console && console.warn) console.warn('[TR] ' + name + ' failed:', e);
    }
  }

  var $  = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var on = function (el, ev, fn, opt) { if (el) el.addEventListener(ev, fn, opt); };

  function clamp(v, a, b) { return Math.min(Math.max(v, a), b); }
  function pad(n) { return String(n).padStart(2, '0'); }

  /* ==================================================================
     1. DUBAI TIME UTILITIES
     Everything below reads the venue's local clock (Asia/Dubai),
     not the visitor's device clock. A guest browsing from London
     sees the same "Open now" answer as one standing at the door.
     ================================================================== */
  function dubaiParts(date) {
    var d = date || new Date();
    var fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: BRAND.tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false, weekday: 'short'
    });
    var out = {};
    fmt.formatToParts(d).forEach(function (p) { out[p.type] = p.value; });
    var hour = parseInt(out.hour, 10);
    if (hour === 24) hour = 0; // some engines report 24 at midnight
    var days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
      year: parseInt(out.year, 10),
      month: parseInt(out.month, 10),
      day: parseInt(out.day, 10),
      hour: hour,
      minute: parseInt(out.minute, 10),
      second: parseInt(out.second, 10),
      weekday: days[out.weekday],
      weekdayName: out.weekday,
      minutesOfDay: hour * 60 + parseInt(out.minute, 10),
      iso: out.year + '-' + out.month + '-' + out.day
    };
  }

  /* Current UTC offset of Dubai in minutes (fixed +240, computed for safety). */
  function dubaiOffsetMinutes(date) {
    var d = date || new Date();
    var utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
    var loc = new Date(d.toLocaleString('en-US', { timeZone: BRAND.tz }));
    return Math.round((loc - utc) / 60000);
  }

  /* Build a real Date from a Dubai wall-clock time. */
  function dubaiDate(y, m, d, hh, mm) {
    var guess = Date.UTC(y, m - 1, d, hh, mm, 0);
    var off = dubaiOffsetMinutes(new Date(guess));
    return new Date(guess - off * 60000);
  }

  /* Open/closed and the next milestone, for whichever branch is in view.
     Branches can keep different door times, so nothing here is a constant. */
  function venueStatus(loc) {
    loc = loc || currentLocation();
    var openMin = openMinutes(loc);
    var closeMin = closeMinutes(loc);
    var p = dubaiParts();
    var mins = p.minutesOfDay;
    var isOpen = mins >= openMin || mins < closeMin;
    var target;

    if (isOpen) {
      // next close: today's closing hour if we're in the small hours, else tomorrow's
      var closeToday = dubaiDate(p.year, p.month, p.day, loc.close.hour, loc.close.minute);
      target = mins < closeMin ? closeToday : new Date(closeToday.getTime() + 864e5);
    } else {
      target = dubaiDate(p.year, p.month, p.day, loc.open.hour, loc.open.minute);
    }
    return { isOpen: isOpen, target: target, parts: p, location: loc };
  }

  function dubaiClockString() {
    var p = dubaiParts();
    return pad(p.hour) + ':' + pad(p.minute);
  }

  /* ==================================================================
     2. PRELOADER
     ================================================================== */
  safe('preloader', function () {
    var el = $('.preloader');
    if (!el) { document.body.classList.add('is-loaded'); return; }
    var bar = $('.preloader__bar span', el);
    var pct = 0;

    var tick = setInterval(function () {
      pct = Math.min(pct + Math.random() * 18 + 6, 100);
      if (bar) bar.style.width = pct + '%';
      if (pct >= 100) clearInterval(tick);
    }, 120);

    function finish() {
      if (bar) bar.style.width = '100%';
      setTimeout(function () {
        el.classList.add('is-done');
        document.body.classList.add('is-loaded');
        document.dispatchEvent(new CustomEvent('site:loaded'));
        setTimeout(function () { el.remove(); }, 800);
      }, 320);
    }

    if (document.readyState === 'complete') { setTimeout(finish, 420); }
    else { on(window, 'load', function () { setTimeout(finish, 420); }); }
    // hard fallback so the site never stays behind the curtain
    setTimeout(function () { if (!el.classList.contains('is-done')) finish(); }, 4200);
  });

  /* ==================================================================
     3. CUSTOM CURSOR
     ================================================================== */
  safe('cursor', function () {
    if (isTouch || reduceMotion) return;
    var ring = $('.cursor'), dot = $('.cursor-dot');
    if (!ring || !dot) return;

    var mx = -100, my = -100, rx = -100, ry = -100;

    on(document, 'mousemove', function (e) {
      mx = e.clientX; my = e.clientY;
      dot.style.transform = 'translate(' + (mx - 2.5) + 'px,' + (my - 2.5) + 'px)';
      if (!ring.classList.contains('is-active')) {
        ring.classList.add('is-active'); dot.classList.add('is-active');
      }
    });
    on(document, 'mouseleave', function () {
      ring.classList.remove('is-active'); dot.classList.remove('is-active');
    });

    (function loop() {
      rx += (mx - rx) * 0.17;
      ry += (my - ry) * 0.17;
      ring.style.transform = 'translate(' + (rx - 17) + 'px,' + (ry - 17) + 'px)';
      requestAnimationFrame(loop);
    })();

    var hoverSel = 'a, button, .tile, .gallery__item, .package, input, select, textarea, label, .tab, .dots button';
    on(document, 'mouseover', function (e) {
      if (e.target.closest(hoverSel)) ring.classList.add('is-hover');
    });
    on(document, 'mouseout', function (e) {
      if (e.target.closest(hoverSel)) ring.classList.remove('is-hover');
    });
  });

  /* ==================================================================
     4. HEADER, SCROLL PROGRESS, BACK TO TOP
     ================================================================== */
  safe('header', function () {
    var head = $('.header');
    var prog = $('.scroll-progress');
    var top  = $('.fab--top');

    function onScroll() {
      var y = window.scrollY || document.documentElement.scrollTop;
      var h = document.documentElement.scrollHeight - window.innerHeight;

      if (prog) prog.style.width = (h > 0 ? clamp(y / h, 0, 1) * 100 : 0) + '%';
      // The bar stays put the whole way down the page and simply condenses
      // once you leave the top, so Reserve a table is always one click away.
      if (head) head.classList.toggle('is-stuck', y > 40);
      if (top) top.classList.toggle('is-shown', y > 700);
    }

    on(window, 'scroll', onScroll, { passive: true });
    onScroll();

    on(top, 'click', function () {
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    });
  });

  /* ==================================================================
     5. MOBILE DRAWER
     ================================================================== */
  safe('drawer', function () {
    var burger = $('.burger'), panel = $('.drawer');
    if (!burger || !panel) return;

    function setOpen(open) {
      burger.classList.toggle('is-open', open);
      panel.classList.toggle('is-open', open);
      document.body.classList.toggle('is-locked', open);
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    }

    on(burger, 'click', function () { setOpen(!panel.classList.contains('is-open')); });
    $$('.drawer a').forEach(function (a) { on(a, 'click', function () { setOpen(false); }); });
    on(document, 'keydown', function (e) {
      if (e.key === 'Escape' && panel.classList.contains('is-open')) setOpen(false);
    });
    on(window, 'resize', function () {
      if (window.innerWidth > 980 && panel.classList.contains('is-open')) setOpen(false);
    });
  });

  /* ==================================================================
     6. ACTIVE NAV LINK
     ================================================================== */
  /* ==================================================================
     5b. HEADER SUBMENU
     Hover opens it on a pointer device. On touch there is no hover, so the
     first tap opens the submenu and a second tap follows the link through.
     ================================================================== */
  safe('navMenu', function () {
    var groups = $$('.nav__group');
    if (!groups.length) return;

    function closeAll(except) {
      groups.forEach(function (g) {
        if (g === except) return;
        g.classList.remove('is-open');
        var t = $('.nav__link--sub', g);
        if (t) t.setAttribute('aria-expanded', 'false');
      });
    }

    groups.forEach(function (group) {
      var trigger = $('.nav__link--sub', group);
      if (!trigger) return;

      on(trigger, 'click', function (e) {
        if (!isTouch) return;                      // pointer devices use hover
        if (group.classList.contains('is-open')) return;   // second tap follows the link
        e.preventDefault();
        closeAll(group);
        group.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
      });

      on(group, 'focusin', function () { trigger.setAttribute('aria-expanded', 'true'); });
      on(group, 'focusout', function (e) {
        if (!group.contains(e.relatedTarget)) trigger.setAttribute('aria-expanded', 'false');
      });
    });

    on(document, 'click', function (e) {
      if (!e.target.closest('.nav__group')) closeAll(null);
    });
    on(document, 'keydown', function (e) {
      if (e.key === 'Escape') closeAll(null);
    });
  });

  safe('activeNav', function () {
    /* Normalise a path or href down to a bare page key, so the same code works
       whether the host serves /about.html or Vercel's clean /about. */
    function pageKey(value) {
      var last = (value || '').split('/').pop().split('#')[0].split('?')[0];
      last = last.replace(/\.html$/i, '');
      return last || 'index';
    }

    var here = pageKey(location.pathname);

    // Nav and drawer links get the gold underline treatment.
    $$('.nav__link, .drawer__link').forEach(function (a) {
      var href = a.getAttribute('href') || '';
      if (!href || href.charAt(0) === '#' || /^(https?:|tel:|mailto:)/i.test(href)) return;
      if (pageKey(href) === here) {
        a.classList.add('is-current');
        a.setAttribute('aria-current', 'page');
      }
    });

    // Reservations is reached through the header CTA rather than a nav link,
    // so mark that button too — otherwise the page has no "you are here" cue.
    $$('.header a[href], .drawer a[href]').forEach(function (a) {
      var href = a.getAttribute('href') || '';
      if (!href || href.charAt(0) === '#' || /^(https?:|tel:|mailto:)/i.test(href)) return;
      if (pageKey(href) === here) a.setAttribute('aria-current', 'page');
    });
  });

  /* ==================================================================
     7. GOLD DUST CANVAS
     ================================================================== */
  safe('dust', function () {
    var cv = $('#dust');
    if (!cv || reduceMotion) return;
    var ctx = null;
    try { ctx = cv.getContext('2d'); } catch (e) { ctx = null; }
    if (!ctx) { cv.style.display = 'none'; return; }
    var parts = [], w = 0, h = 0, raf;

    function size() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = cv.width = Math.floor(window.innerWidth * dpr);
      h = cv.height = Math.floor(window.innerHeight * dpr);
      cv.style.width = window.innerWidth + 'px';
      cv.style.height = window.innerHeight + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      build();
    }

    function build() {
      var area = window.innerWidth * window.innerHeight;
      var count = clamp(Math.round(area / 26000), 18, 70);
      parts = [];
      for (var i = 0; i < count; i++) {
        parts.push({
          x: Math.random() * window.innerWidth,
          y: Math.random() * window.innerHeight,
          r: Math.random() * 1.5 + 0.35,
          vx: (Math.random() - 0.5) * 0.16,
          vy: -(Math.random() * 0.3 + 0.06),
          a: Math.random() * 0.5 + 0.12,
          tw: Math.random() * Math.PI * 2
        });
      }
    }

    function frame() {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        p.x += p.vx; p.y += p.vy; p.tw += 0.02;
        if (p.y < -12) { p.y = window.innerHeight + 12; p.x = Math.random() * window.innerWidth; }
        if (p.x < -12) p.x = window.innerWidth + 12;
        if (p.x > window.innerWidth + 12) p.x = -12;
        var alpha = p.a * (0.55 + Math.sin(p.tw) * 0.45);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(212,175,55,' + alpha.toFixed(3) + ')';
        ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    }

    size();
    frame();
    on(window, 'resize', size);
    on(document, 'visibilitychange', function () {
      if (document.hidden) { cancelAnimationFrame(raf); }
      else { raf = requestAnimationFrame(frame); }
    });
  });

  /* ==================================================================
     8. SCROLL REVEAL
     ================================================================== */
  safe('reveal', function () {
    var items = $$('[data-reveal]');
    if (!items.length) return;

    if (!('IntersectionObserver' in window) || reduceMotion) {
      items.forEach(function (el) { el.classList.add('is-in'); });
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target;
        var delay = parseFloat(el.getAttribute('data-delay') || 0);
        setTimeout(function () { el.classList.add('is-in'); }, delay * 1000);
        io.unobserve(el);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

    items.forEach(function (el) { io.observe(el); });
  });

  /* ==================================================================
     9. COUNTERS
     ================================================================== */
  safe('counters', function () {
    var nums = $$('[data-count]');
    if (!nums.length) return;

    function run(el) {
      var target = parseFloat(el.getAttribute('data-count'));
      var suffix = el.getAttribute('data-suffix') || '';
      var prefix = el.getAttribute('data-prefix') || '';
      var dur = 1700, t0 = null;
      if (reduceMotion) { el.textContent = prefix + target + suffix; return; }

      function step(ts) {
        if (!t0) t0 = ts;
        var p = clamp((ts - t0) / dur, 0, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        var val = target % 1 === 0 ? Math.round(target * eased) : (target * eased).toFixed(1);
        el.textContent = prefix + val + suffix;
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }

    if (!('IntersectionObserver' in window)) { nums.forEach(run); return; }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { run(e.target); io.unobserve(e.target); } });
    }, { threshold: 0.5 });
    nums.forEach(function (n) { io.observe(n); });
  });

  /* ==================================================================
     9b. LOCATIONS — render the branch in view, everywhere at once

     Any element carrying data-loc / data-loc-href / data-loc-src is filled
     from the selected branch. Add a venue to LOCATIONS and the picker
     appears by itself; with a single venue it stays hidden and the page
     simply reads as that one venue.
     ================================================================== */
  function locMetroFull(loc) {
    if (!loc.metro) return '';
    return loc.metro + (loc.metroLine ? ', ' + loc.metroLine : '');
  }

  function mapsSearchUrl(loc) {
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(loc.mapQuery);
  }
  function mapsEmbedUrl(loc) {
    return 'https://www.google.com/maps?q=' + encodeURIComponent(loc.mapQuery) + '&output=embed';
  }

  function applyLocation(loc) {
    loc = loc || currentLocation();

    var text = {
      name:       loc.name,
      venue:      loc.venue,
      area:       loc.name,
      addressLine: loc.address.join(', '),
      // everything after the venue name, for places that already show it above
      street:     loc.address.slice(1).join(', '),
      phone:      loc.phone,
      hours:      hoursLabel(loc),
      doors:      time12(loc.open.hour, loc.open.minute),
      closes:     time12(loc.close.hour, loc.close.minute),
      lastEntry:  loc.lastEntry,
      metro:      loc.metro,
      metroLine:  loc.metroLine,
      metroFull:  locMetroFull(loc),
      metroWalk:  loc.metroWalk,
      parking:    loc.parking
    };

    $$('[data-loc]').forEach(function (el) {
      var key = el.getAttribute('data-loc');
      if (key === 'address') { el.innerHTML = loc.address.join('<br>'); return; }
      if (Object.prototype.hasOwnProperty.call(text, key) && text[key] != null) {
        el.textContent = text[key];
      }
    });

    $$('[data-loc-href]').forEach(function (el) {
      var kind = el.getAttribute('data-loc-href');
      if (kind === 'tel') {
        el.setAttribute('href', 'tel:' + loc.phoneRaw);
      } else if (kind === 'whatsapp') {
        // Keep any prefilled ?text= message when swapping the number over.
        var existing = el.getAttribute('href') || '';
        var q = existing.indexOf('?');
        el.setAttribute('href', 'https://wa.me/' + loc.whatsapp + (q > -1 ? existing.slice(q) : ''));
      } else if (kind === 'maps') {
        el.setAttribute('href', mapsSearchUrl(loc));
      }
    });

    $$('[data-loc-src="map"]').forEach(function (el) {
      var next = mapsEmbedUrl(loc);
      if (el.getAttribute('src') !== next) el.setAttribute('src', next);
      el.setAttribute('title', 'Map showing ' + BRAND.name + ' at ' + loc.address.join(', '));
    });

    document.documentElement.setAttribute('data-location', loc.id);
  }

  function renderPickers() {
    $$('[data-location-picker]').forEach(function (host) {
      // A picker for one venue is just noise.
      if (!multiSite) { host.hidden = true; return; }
      host.hidden = false;
      if (host.getAttribute('data-built')) return;

      var current = currentLocation();
      host.setAttribute('role', 'group');
      host.setAttribute('aria-label', 'Choose a venue');
      host.innerHTML = '';

      LOCATIONS.forEach(function (loc) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'locpick__btn' + (loc.id === current.id ? ' is-active' : '');
        b.setAttribute('data-loc-id', loc.id);
        b.setAttribute('aria-pressed', loc.id === current.id ? 'true' : 'false');
        b.innerHTML = '<span class="locpick__name">' + loc.name + '</span>' +
                      '<span class="locpick__meta">' + loc.venue + '</span>';
        on(b, 'click', function () { setLocation(loc.id); });
        host.appendChild(b);
      });
      host.setAttribute('data-built', '1');
    });
  }

  function syncPickers(loc) {
    $$('[data-location-picker] .locpick__btn').forEach(function (b) {
      var active = b.getAttribute('data-loc-id') === loc.id;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  safe('locations', function () {
    // Hide anything that only makes sense with more than one venue.
    $$('[data-multi-only]').forEach(function (el) { el.hidden = !multiSite; });

    renderPickers();
    applyLocation();

    on(document, 'location:change', function () {
      var loc = currentLocation();
      applyLocation(loc);
      syncPickers(loc);
      document.dispatchEvent(new CustomEvent('location:applied', { detail: { id: loc.id } }));
    });
  });

  /* ==================================================================
     10. LIVE VENUE STATUS + COUNTDOWN + TODAY HIGHLIGHT
     ================================================================== */
  safe('liveStatus', function () {
    var pills   = $$('[data-status-pill]');
    var labels  = $$('[data-status-label]');
    var clocks  = $$('[data-dubai-clock]');
    var cdWraps = $$('[data-countdown]');
    var cdTitle = $$('[data-countdown-title]');

    function render() {
      var st = venueStatus();

      pills.forEach(function (el) {
        el.classList.toggle('is-open', st.isOpen);
        el.classList.toggle('is-closed', !st.isOpen);
      });
      labels.forEach(function (el) {
        el.textContent = st.isOpen ? 'Open now' : 'Closed';
      });
      clocks.forEach(function (el) { el.textContent = dubaiClockString(); });

      cdTitle.forEach(function (el) {
        el.textContent = st.isOpen ? 'Last call in' : 'Doors open in';
      });

      var diff = Math.max(0, st.target - new Date());
      var totalSec = Math.floor(diff / 1000);
      var hrs = Math.floor(totalSec / 3600);
      var min = Math.floor((totalSec % 3600) / 60);
      var sec = totalSec % 60;

      cdWraps.forEach(function (wrap) {
        var h = $('[data-cd="h"]', wrap), m = $('[data-cd="m"]', wrap), s = $('[data-cd="s"]', wrap);
        if (h) h.textContent = pad(hrs);
        if (m) m.textContent = pad(min);
        if (s) s.textContent = pad(sec);
      });
    }

    // Highlight today's row in the footer hours list (Dubai's day, not the visitor's)
    var todayIdx = dubaiParts().weekday;
    $$('[data-day]').forEach(function (el) {
      if (parseInt(el.getAttribute('data-day'), 10) === todayIdx) el.classList.add('is-today');
    });

    if (pills.length || labels.length || clocks.length || cdWraps.length) {
      render();
      setInterval(render, 1000);
    }
  });

  /* ==================================================================
     11. TICKER — duplicate the group so the loop is seamless
     ================================================================== */
  safe('ticker', function () {
    $$('.ticker__track').forEach(function (track) {
      var group = $('.ticker__group', track);
      if (!group) return;
      var clone = group.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      track.appendChild(clone);
    });
  });

  /* ==================================================================
     12. PARALLAX
     ================================================================== */
  safe('parallax', function () {
    var els = $$('[data-parallax]');
    if (!els.length || reduceMotion || isTouch) return;
    var ticking = false;

    function update() {
      var vh = window.innerHeight;
      els.forEach(function (el) {
        var speed = parseFloat(el.getAttribute('data-parallax')) || 0.15;
        var r = el.getBoundingClientRect();
        if (r.bottom < -200 || r.top > vh + 200) return;
        var offset = (r.top + r.height / 2 - vh / 2) * speed * -1;
        el.style.transform = 'translate3d(0,' + offset.toFixed(2) + 'px,0)';
      });
      ticking = false;
    }
    on(window, 'scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  });

  /* ==================================================================
     13. LINE-UP TABS
     ================================================================== */
  safe('tabs', function () {
    $$('[data-tabs]').forEach(function (group) {
      var buttons = $$('.tab', group);
      var panelWrap = document.querySelector(group.getAttribute('data-tabs'));
      if (!buttons.length || !panelWrap) return;

      function select(key) {
        buttons.forEach(function (b) {
          var active = b.getAttribute('data-tab') === key;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        $$('[data-panel]', panelWrap).forEach(function (p) {
          var show = p.getAttribute('data-panel') === key;
          p.hidden = !show;
          if (show) { p.style.animation = 'none'; void p.offsetWidth; p.style.animation = ''; }
        });
      }

      buttons.forEach(function (b) {
        on(b, 'click', function () { select(b.getAttribute('data-tab')); });
      });

      // default to tonight in Dubai
      var today = String(dubaiParts().weekday);
      var match = buttons.filter(function (b) { return b.getAttribute('data-tab') === today; })[0];
      select(match ? today : buttons[0].getAttribute('data-tab'));

      // mark tonight's tab
      if (match) {
        var dot = document.createElement('span');
        dot.className = 'dot';
        dot.title = 'Tonight';
        match.appendChild(dot);
      }
    });
  });

  /* ==================================================================
     14. GALLERY FILTER + LIGHTBOX
     ================================================================== */
  safe('gallery', function () {
    // The menu page carries one grid per section, so collect items from every
    // grid rather than the first. Scoping to $('.gallery') left the lightbox
    // working only on whichever section happened to be first in the markup.
    if (!$('.gallery')) return;

    var items = $$('.gallery__item');

    // --- filters
    // Two levels: the granular categories, and the two groupings the header
    // submenu links to. Venue is the place, Performance is what happens on it.
    var GROUPS = {
      venue:       ['venue', 'bar', 'crowd'],
      performance: ['shows', 'dj', 'celebrations']
    };

    function filterButtons() { return $$('[data-filter], [data-filter-group]'); }

    function applyFilter(btn) {
      var key   = btn.getAttribute('data-filter');
      var group = btn.getAttribute('data-filter-group');
      var cats  = group ? GROUPS[group] : null;

      filterButtons().forEach(function (b) { b.classList.toggle('is-active', b === btn); });
      items.forEach(function (it) {
        var cat = it.getAttribute('data-cat') || '';
        var show = cats ? cats.indexOf(cat) > -1 : (key === 'all' || cat === key);
        it.classList.toggle('is-hidden', !show);
      });
    }

    filterButtons().forEach(function (btn) {
      on(btn, 'click', function () { applyFilter(btn); });
    });

    /* The submenu links to ?view=venue and ?view=performance. As well as
       filtering the grid, each view swaps the page's opening copy, backdrop,
       breadcrumb and title, so it reads as its own page rather than a
       filtered gallery. */
    var VIEW_TITLES = {
      performance: { title: 'Live Dance Performances | The Royals, Al Barsha', crumb: 'Performances' },
      venue:       { title: 'The Venue | The Royals, Al Barsha',               crumb: 'Venue' }
    };

    // the page keeps one h1; only its text changes between views
    var headingEl = $('[data-view-heading]');
    var eyebrowEl = $('[data-view-eyebrow]');
    var headingDefault = headingEl ? headingEl.innerHTML : '';
    var eyebrowDefault = eyebrowEl ? eyebrowEl.textContent : '';

    function applyViewCopy(view) {
      var blocks = $$('[data-view-copy]');
      if (!blocks.length) return;
      var key = VIEW_TITLES[view] ? view : 'default';

      blocks.forEach(function (b) { b.hidden = b.getAttribute('data-view-copy') !== key; });

      var active = $('[data-view-copy="' + key + '"]');
      var bg = active && active.getAttribute('data-view-bg');
      var hero = $('.page-hero__bg');
      if (hero && bg) hero.style.backgroundImage = 'url("' + bg + '")';

      if (headingEl) {
        var h = active && active.getAttribute('data-view-heading-html');
        headingEl.innerHTML = h || headingDefault;
      }
      if (eyebrowEl) {
        var e = active && active.getAttribute('data-view-eyebrow-text');
        eyebrowEl.textContent = e || eyebrowDefault;
      }

      var meta = VIEW_TITLES[view];
      if (meta) {
        document.title = meta.title;
        var crumb = $('[data-view-crumb]');
        if (crumb) crumb.textContent = meta.crumb;
      }
    }

    try {
      var view = (new URLSearchParams(location.search).get('view') || '').toLowerCase();
      if (view && GROUPS[view]) {
        var target = $('[data-filter-group="' + view + '"]');
        if (target) applyFilter(target);
        applyViewCopy(view);
      }
    } catch (err) {}

    /* Clicking a filter by hand means the guest has left the curated view,
       so put the general gallery wording back. */
    filterButtons().forEach(function (btn) {
      on(btn, 'click', function () {
        applyViewCopy(btn.getAttribute('data-filter-group') || 'default');
      });
    });

    // --- lightbox
    var box = $('.lightbox');
    if (!box) return;
    var img = $('[data-lb-img]', box);
    var cap = $('[data-lb-cap]', box);
    var cat = $('[data-lb-cat]', box);
    var idxEl = $('[data-lb-index]', box);
    var current = 0;

    /* What the lightbox may step through: not filtered out by category, and
       not sitting inside a section tab that is closed. Checked through the
       DOM rather than via offsetParent, because that depends on layout and
       reads as null in environments that do not lay pages out at all. */
    function visible() {
      return items.filter(function (i) {
        if (i.classList.contains('is-hidden')) return false;
        var panel = i.closest('[hidden]');
        return !panel;
      });
    }

    function show(i) {
      var list = visible();
      if (!list.length) return;
      current = (i + list.length) % list.length;
      var it = list[current];
      var src = it.getAttribute('data-full') || ($('img', it) || {}).src;
      if (img) { img.src = src; img.alt = it.getAttribute('data-title') || 'The Royals'; }
      if (cap) cap.textContent = it.getAttribute('data-title') || '';
      if (cat) cat.textContent = it.getAttribute('data-caption') || '';
      if (idxEl) idxEl.textContent = (current + 1) + ' / ' + list.length;
    }

    function open(i) {
      show(i);
      box.classList.add('is-open');
      document.body.classList.add('is-locked');
      box.setAttribute('aria-hidden', 'false');
      var c = $('.lb-close', box); if (c) c.focus();
    }
    function close() {
      box.classList.remove('is-open');
      document.body.classList.remove('is-locked');
      box.setAttribute('aria-hidden', 'true');
    }

    items.forEach(function (it) {
      on(it, 'click', function () { open(visible().indexOf(it)); });
      on(it, 'keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(visible().indexOf(it)); }
      });
    });

    on($('.lb-close', box), 'click', close);
    on($('.lb-prev', box), 'click', function () { show(current - 1); });
    on($('.lb-next', box), 'click', function () { show(current + 1); });
    on(box, 'click', function (e) { if (e.target === box) close(); });

    on(document, 'keydown', function (e) {
      if (!box.classList.contains('is-open')) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') show(current - 1);
      if (e.key === 'ArrowRight') show(current + 1);
    });

    // swipe
    var sx = 0;
    on(box, 'touchstart', function (e) { sx = e.changedTouches[0].clientX; }, { passive: true });
    on(box, 'touchend', function (e) {
      var dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) > 55) show(dx < 0 ? current + 1 : current - 1);
    }, { passive: true });
  });

  /* ==================================================================
     15. TESTIMONIAL CAROUSEL
     ================================================================== */
  safe('quotes', function () {
    var root = $('.quotes');
    if (!root) return;
    var track = $('.quotes__track', root);
    var slides = $$('.quotes__slide', root);
    var dotsWrap = $('.dots', root);
    if (!track || slides.length < 1) return;

    var i = 0, timer = null;

    slides.forEach(function (_, n) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', 'Go to review ' + (n + 1));
      on(b, 'click', function () { go(n); restart(); });
      if (dotsWrap) dotsWrap.appendChild(b);
    });

    function go(n) {
      i = (n + slides.length) % slides.length;
      track.style.transform = 'translateX(' + (-i * 100) + '%)';
      if (dotsWrap) {
        $$('button', dotsWrap).forEach(function (d, k) { d.classList.toggle('is-active', k === i); });
      }
      slides.forEach(function (s, k) { s.setAttribute('aria-hidden', k === i ? 'false' : 'true'); });
    }
    function next() { go(i + 1); }
    function restart() { if (timer) clearInterval(timer); if (!reduceMotion) timer = setInterval(next, 6500); }

    on($('[data-quote-next]', root), 'click', function () { next(); restart(); });
    on($('[data-quote-prev]', root), 'click', function () { go(i - 1); restart(); });

    on(root, 'mouseenter', function () { if (timer) clearInterval(timer); });
    on(root, 'mouseleave', restart);

    var sx = 0;
    on(root, 'touchstart', function (e) { sx = e.changedTouches[0].clientX; }, { passive: true });
    on(root, 'touchend', function (e) {
      var dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) > 50) { dx < 0 ? next() : go(i - 1); restart(); }
    }, { passive: true });

    go(0);
    restart();
  });

  /* ==================================================================
     16. FORM VALIDATION HELPERS
     ================================================================== */
  function setError(field, msg) {
    if (!field) return;
    field.classList.add('has-error');
    var slot = $('.field__error', field);
    if (slot) slot.textContent = msg;
    var input = $('input, select, textarea', field);
    if (input) input.setAttribute('aria-invalid', 'true');
  }
  function clearError(field) {
    if (!field) return;
    field.classList.remove('has-error');
    var input = $('input, select, textarea', field);
    if (input) input.removeAttribute('aria-invalid');
  }

  var RX = {
    email: /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i,
    // UAE mobile (05x / +9715x) plus generous international fallback
    phone: /^(\+?\d{1,4}[\s-]?)?\(?\d{2,4}\)?[\s-]?\d{3}[\s-]?\d{3,4}$/
  };

  function validateField(input) {
    var field = input.closest('.field');
    if (input.type === 'checkbox' || input.type === 'radio') return true; // handled by validateScope
    var val = (input.value || '').trim();
    var type = input.getAttribute('data-validate') || input.type;

    if (input.hasAttribute('required') && !val) {
      setError(field, 'This field is required.');
      return false;
    }
    if (!val) { clearError(field); return true; }

    if (type === 'email' && !RX.email.test(val)) {
      setError(field, 'Enter a valid email address.'); return false;
    }
    if (type === 'tel' && !RX.phone.test(val.replace(/\s/g, ''))) {
      setError(field, 'Enter a valid phone number, e.g. 050 123 4567.'); return false;
    }
    if (input.name === 'name' && val.length < 2) {
      setError(field, 'Please enter your full name.'); return false;
    }
    if (input.name === 'message' && val.length < 10) {
      setError(field, 'Please add a little more detail (10 characters minimum).'); return false;
    }
    clearError(field);
    return true;
  }

  function wireLiveValidation(form) {
    $$('input, select, textarea', form).forEach(function (input) {
      on(input, 'blur', function () { validateField(input); });
      on(input, 'input', function () {
        if (input.closest('.field') && input.closest('.field').classList.contains('has-error')) {
          validateField(input);
        }
      });
    });
  }

  function validateScope(scope) {
    var ok = true;
    $$('input, select, textarea', scope).forEach(function (input) {
      if (input.type === 'hidden' || input.disabled) return;
      if (input.type === 'checkbox') {
        if (input.hasAttribute('required') && !input.checked) {
          setError(input.closest('.field') || input.closest('.check'), 'Please confirm to continue.');
          ok = false;
        }
        return;
      }
      if (input.type === 'radio') return;
      if (!validateField(input)) ok = false;
    });
    // radio groups
    var seen = {};
    $$('input[type="radio"][required]', scope).forEach(function (r) {
      if (seen[r.name]) return;
      seen[r.name] = true;
      var checked = scope.querySelector('input[name="' + r.name + '"]:checked');
      if (!checked) {
        setError(r.closest('.field'), 'Please choose an option.');
        ok = false;
      } else {
        clearError(r.closest('.field'));
      }
    });
    return ok;
  }

  function showNote(form, kind, html) {
    $$('.form-note', form).forEach(function (n) { n.classList.remove('is-shown'); });
    var note = $('.form-note--' + kind, form);
    if (!note) return;
    var body = $('[data-note-body]', note);
    if (body && html) body.innerHTML = html;
    note.classList.add('is-shown');
    note.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  }

  /* ==================================================================
     17. RESERVATION FORM (multi-step + WhatsApp handoff)
     ================================================================== */
  safe('reservation', function () {
    var form = $('#reservation-form');
    if (!form) return;

    var sets  = $$('.fieldset', form);
    var steps = $$('.step', form.closest('section') || document);
    var btnNext = $('[data-next]', form);
    var btnPrev = $('[data-prev]', form);
    var btnSend = $('[data-submit]', form);
    var idx = 0, first = true;

    wireLiveValidation(form);

    /* --- preselect seating from ?table=Gold on the pricing cards --- */
    try {
      var wanted = new URLSearchParams(location.search).get('table');
      if (wanted) {
        var map = { standard: 's-standard', silver: 's-silver', gold: 's-gold', royal: 's-royal' };
        var radio = document.getElementById(map[wanted.toLowerCase()] || '');
        if (radio) radio.checked = true;
      }
    } catch (err) {}

    /* --- date bounds in Dubai time --- */
    var dateInput = form.querySelector('input[name="date"]');
    if (dateInput) {
      var p = dubaiParts();
      var todayISO = p.year + '-' + pad(p.month) + '-' + pad(p.day);
      // Before 04:00 Dubai the venue is still on "last night" — today is still bookable.
      dateInput.min = todayISO;
      var max = new Date(dubaiDate(p.year, p.month, p.day, 12, 0).getTime() + 90 * 864e5);
      var mp = dubaiParts(max);
      dateInput.max = mp.year + '-' + pad(mp.month) + '-' + pad(mp.day);
      if (!dateInput.value) dateInput.value = todayISO;
    }

    /* --- venue choice ---
       Branches can differ in door times, so the arrival list is rebuilt
       whenever the chosen venue changes. With one venue the picker stays
       hidden and a hidden input still carries the id through to the booking. */
    var locHost = $('[data-location-field]', form);

    function selectedLocation() {
      var picked = form.querySelector('input[name="location"]:checked') ||
                   form.querySelector('input[name="location"]');
      return (picked && locationById(picked.value)) || currentLocation();
    }

    function buildLocationField() {
      if (!locHost) return;
      locHost.innerHTML = '';

      if (!multiSite) {
        var hidden = document.createElement('input');
        hidden.type = 'hidden';
        hidden.name = 'location';
        hidden.value = LOCATIONS[0].id;
        locHost.appendChild(hidden);
        return;
      }

      var active = currentLocation();
      LOCATIONS.forEach(function (l, i) {
        var id = 'r-loc-' + l.id;
        var input = document.createElement('input');
        input.type = 'radio';
        input.name = 'location';
        input.id = id;
        input.value = l.id;
        if (i === 0) input.required = true;
        if (l.id === active.id) input.checked = true;

        var label = document.createElement('label');
        label.setAttribute('for', id);
        label.className = 'locfield__card';
        label.innerHTML =
          '<span class="locfield__name">' + l.name + '</span>' +
          '<span class="locfield__venue">' + l.venue + '</span>' +
          '<span class="locfield__meta">Doors ' + time12(l.open.hour, l.open.minute) +
          ' · ' + locMetroFull(l) + '</span>';

        on(input, 'change', function () {
          setLocation(l.id);
          buildTimeSlots(l);
        });

        locHost.appendChild(input);
        locHost.appendChild(label);
      });
    }

    /* --- arrival time: only within the chosen venue's hours --- */
    var timeSelect = form.querySelector('select[name="time"]');

    function buildTimeSlots(loc) {
      if (!timeSelect) return;
      loc = loc || selectedLocation();
      var keep = timeSelect.value;
      timeSelect.innerHTML = '';

      var ph = new Option('Select arrival time', '');
      ph.disabled = true; ph.selected = true;
      timeSelect.appendChild(ph);

      // Last bookable arrival is an hour before close.
      for (var m = openMinutes(loc); m <= 24 * 60 + closeMinutes(loc) - 60; m += 30) {
        var mm = m % (24 * 60);
        var value = pad(Math.floor(mm / 60)) + ':' + pad(mm % 60);
        var hh = Math.floor(mm / 60);
        timeSelect.appendChild(new Option(value + (hh < 12 ? '  (after midnight)' : ''), value));
      }
      // Keep the guest's choice if that time still exists at the new venue.
      if (keep) timeSelect.value = keep;
    }

    buildLocationField();
    buildTimeSlots();

    function paint() {
      sets.forEach(function (fs, n) { fs.classList.toggle('is-active', n === idx); });
      steps.forEach(function (st, n) {
        st.classList.toggle('is-active', n === idx);
        st.classList.toggle('is-done', n < idx);
      });
      if (btnPrev) btnPrev.hidden = idx === 0;
      if (btnNext) btnNext.hidden = idx >= sets.length - 1;
      if (btnSend) btnSend.hidden = idx < sets.length - 1;
      if (idx === sets.length - 1) buildReview();
      if (!first) {
        var head = form.getBoundingClientRect().top + window.scrollY - 140;
        window.scrollTo({ top: head, behavior: reduceMotion ? 'auto' : 'smooth' });
      }
      first = false;
    }

    function data() {
      var fd = new FormData(form), o = {};
      fd.forEach(function (v, k) { o[k] = v; });
      return o;
    }

    function prettyTime(t) {
      if (!t) return '—';
      var hh = parseInt(t.split(':')[0], 10), mm = t.split(':')[1];
      var suffix = hh >= 12 ? 'PM' : 'AM';
      var h12 = hh % 12 || 12;
      return h12 + ':' + mm + ' ' + suffix + (hh < 12 ? ' (after midnight)' : '');
    }
    function prettyDate(d) {
      if (!d) return '—';
      var parts = d.split('-');
      var dt = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
      return dt.toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
      });
    }

    function buildReview() {
      var wrap = $('[data-review]', form);
      if (!wrap) return;
      var d = data();
      var loc = locationById(d.location) || currentLocation();
      var rows = [
        ['Venue', loc.venue + ', ' + loc.name],
        ['Name', d.name || '—'],
        ['Phone', d.phone || '—'],
        ['Email', d.email || '—'],
        ['Date', prettyDate(d.date)],
        ['Arrival', prettyTime(d.time)],
        ['Guests', d.guests || '—'],
        ['Seating', d.seating || '—'],
        ['Occasion', d.occasion || 'None'],
        ['Notes', d.notes || 'None']
      ];
      wrap.innerHTML = rows.map(function (r) {
        return '<div><dt>' + r[0] + '</dt><dd>' + String(r[1]).replace(/</g, '&lt;') + '</dd></div>';
      }).join('');
    }

    on(btnNext, 'click', function () {
      if (!validateScope(sets[idx])) return;
      idx = Math.min(idx + 1, sets.length - 1);
      paint();
    });
    on(btnPrev, 'click', function () {
      idx = Math.max(idx - 1, 0);
      paint();
    });

    on(form, 'submit', function (e) {
      e.preventDefault();
      if (!validateScope(form)) {
        showNote(form, 'err', 'Some details still need attention. Please review the highlighted fields.');
        return;
      }
      var d = data();
      if (btnSend) { btnSend.classList.add('is-busy'); btnSend.textContent = 'Sending…'; }

      // Route the request to the branch the guest chose, and name it in the message
      // so the host team never has to guess which door the booking is for.
      var loc = locationById(d.location) || currentLocation();

      var lines = [
        'TABLE RESERVATION — ' + BRAND.name + ', ' + loc.name,
        '',
        'Venue: ' + loc.venue + ', ' + loc.name,
        'Name: ' + d.name,
        'Phone: ' + d.phone,
        'Email: ' + (d.email || '—'),
        'Date: ' + prettyDate(d.date),
        'Arrival: ' + prettyTime(d.time),
        'Guests: ' + d.guests,
        'Seating: ' + d.seating,
        'Occasion: ' + (d.occasion || '—'),
        'Notes: ' + (d.notes || '—')
      ];
      var wa = 'https://wa.me/' + loc.whatsapp + '?text=' + encodeURIComponent(lines.join('\n'));

      /* Opened here, not inside the timer below. A popup is only permitted
         while the click that caused it is still the active user gesture, and
         Safari has withdrawn that long before a 900ms timer fires. The pause
         is stagecraft; the handoff is the booking itself, so it goes first.
         The note below still carries the link regardless, because passing
         'noopener' makes window.open return null whether it opened or was
         blocked — there is no way to tell the two apart, so the guest is
         always given a way through. */
      window.open(wa, '_blank', 'noopener');

      setTimeout(function () {
        if (btnSend) { btnSend.classList.remove('is-busy'); btnSend.textContent = 'Confirm request'; }
        showNote(form, 'ok',
          '<strong>Request received, ' + String(d.name).split(' ')[0].replace(/</g, '&lt;') + '.</strong><br>' +
          'Your table request for <b>' + prettyDate(d.date) + '</b> at <b>' + prettyTime(d.time) + '</b> has been prepared. ' +
          'Our host team confirms every booking personally on WhatsApp — a new tab has opened so you can send it through. ' +
          'If nothing opened, <a href="' + wa + '" target="_blank" rel="noopener" style="color:var(--gold)">send it here</a>, ' +
          'or call us on <a href="tel:' + loc.phoneRaw + '" style="color:var(--gold)">' + loc.phone + '</a>.'
        );
        try { form.reset(); } catch (err) {}
      }, 900);
    });

    paint();
  });

  /* ==================================================================
     18. CONTACT / SIMPLE FORMS

     Posted to /api/contact, which passes it to Resend and on to the venue's
     inbox. The thank-you is shown only once the server has confirmed the
     send: a form that thanks you for a message nobody received is worse
     than no form at all, because the guest stops waiting for a reply that
     was never coming.
     ================================================================== */
  safe('simpleForms', function () {
    $$('form[data-simple-form]').forEach(function (form) {
      wireLiveValidation(form);
      on(form, 'submit', function (e) {
        e.preventDefault();
        if (!validateScope(form)) {
          showNote(form, 'err', 'Please check the highlighted fields and try again.');
          return;
        }

        var btn   = $('[type="submit"]', form);
        var label = btn ? btn.textContent : '';
        if (btn) { btn.classList.add('is-busy'); btn.disabled = true; btn.textContent = 'Sending…'; }

        // Quote back the hours and number of the branch the visitor is viewing.
        var loc = currentLocation();

        function value(name) {
          var el = form.elements[name];
          return el ? String(el.value || '').trim() : '';
        }
        function restore() {
          if (!btn) return;
          btn.classList.remove('is-busy');
          btn.disabled = false;
          btn.textContent = label;
        }
        function reachUs(lead) {
          showNote(form, 'err',
            '<strong>' + lead + '</strong><br>' +
            'Nothing you wrote has been lost. Try again in a moment, or reach us on ' +
            '<a href="https://wa.me/' + loc.whatsapp + '" style="color:var(--gold)">WhatsApp</a> ' +
            'or <a href="tel:' + loc.phoneRaw + '" style="color:var(--gold)">' + loc.phone + '</a>.'
          );
        }

        fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name:    value('name'),
            email:   value('email'),
            phone:   value('phone'),
            subject: value('subject'),
            message: value('message'),
            company: value('company'),
            consent: !!(form.elements.consent && form.elements.consent.checked)
          })
        }).then(function (res) {
          restore();
          if (res.ok) {
            showNote(form, 'ok',
              '<strong>Thank you — your message is on its way.</strong><br>' +
              'Our team replies within a few hours during opening times (' + hoursLabel(loc) + ', Dubai). ' +
              'For anything urgent, WhatsApp us on <a href="https://wa.me/' + loc.whatsapp + '" style="color:var(--gold)">' + loc.phone + '</a>.'
            );
            form.reset();
            return;
          }
          return res.json().then(function (d) { return d; }, function () { return {}; })
            .then(function (data) { reachUs(data.error || 'The message could not be sent.'); });
        }).catch(function () {
          restore();
          reachUs('The message could not be sent.');
        });
      });
    });
  });

  /* ==================================================================
     19. NEWSLETTER

     The list lives in a Supabase table the browser may insert into and
     cannot read back — see supabase/migrations for the policy. These two
     values are also in assets/js/auth.js. Duplicating them beats a third
     script tag on eight pages for the sake of one URL, and the key is
     publishable: it is meant to be read by the browser and grants only
     what Row Level Security allows.
     ================================================================== */
  var SUPABASE = {
    url: 'https://atzkuodhsooszjavlqgw.supabase.co',
    key: 'sb_publishable_D5Dxssbqx-1c_BVEWWSGLA_zFYEGtrD'
  };

  safe('newsletter', function () {
    $$('form[data-newsletter]').forEach(function (form) {
      on(form, 'submit', function (e) {
        e.preventDefault();

        var input = $('input[type="email"]', form);
        var field = input ? input.closest('.field') : null;
        var trap  = $('input[name="company"]', form);
        var btn   = $('[type="submit"]', form);

        function settle(label) {
          if (!btn) return;
          btn.disabled = false;
          btn.textContent = label;
          setTimeout(function () { btn.textContent = 'Join'; }, 3200);
        }

        function accepted() {
          input.value = '';
          input.placeholder = 'You are on the guest list.';
          settle('Subscribed ✓');
        }

        function failed() {
          if (btn) { btn.disabled = false; btn.textContent = 'Join'; }
          setError(field, 'That did not go through. Please try again in a moment.');
        }

        if (!input || !RX.email.test(input.value.trim())) {
          setError(field, 'Enter a valid email address.');
          return;
        }
        clearError(field);

        /* Something filled in a field no person can see. Give it the same
           success it would have got anyway and send nothing: a bot told it
           failed simply comes back differently. */
        if (trap && trap.value) { accepted(); return; }

        if (btn) { btn.disabled = true; btn.textContent = 'Joining…'; }

        fetch(SUPABASE.url + '/rest/v1/newsletter_subscribers', {
          method: 'POST',
          headers: {
            'apikey': SUPABASE.key,
            'Authorization': 'Bearer ' + SUPABASE.key,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            email: input.value.trim().toLowerCase(),
            source: location.pathname
          })
        }).then(function (res) {
          /* 409 is the unique index refusing a second copy of an address.
             From the guest's side that is not a failure — they are on the
             list, which is the whole of what they asked for. */
          if (res.ok || res.status === 409) accepted();
          else failed();
        }).catch(failed);
      });
    });
  });

  /* ==================================================================
     21. MENU PDF — open in a new tab, everywhere
     ================================================================== */
  safe('menuLinks', function () {
    // The menu is a page on this site now, so the markup already carries the
    // right href. Just make sure nothing is left pointing at the old PDF.
    $$('[data-menu-link]').forEach(function (a) {
      a.setAttribute('href', BRAND.menuPage);
      a.removeAttribute('target');
      a.removeAttribute('rel');
    });
  });

  /* ==================================================================
     22. SMOOTH ANCHOR SCROLL
     ================================================================== */
  safe('anchors', function () {
    on(document, 'click', function (e) {
      var a = e.target.closest('a[href^="#"]');
      if (!a) return;
      var id = a.getAttribute('href');
      if (!id || id === '#' || id.length < 2) return;
      var t = document.querySelector(id);
      if (!t) return;
      e.preventDefault();
      var y = t.getBoundingClientRect().top + window.scrollY - 92;
      window.scrollTo({ top: y, behavior: reduceMotion ? 'auto' : 'smooth' });
      history.replaceState(null, '', id);
    });
  });

  /* ==================================================================
     23. YEAR STAMP
     ================================================================== */
  $$('[data-year]').forEach(function (el) { el.textContent = new Date().getFullYear(); });

  /* ==================================================================
     24. CARD TILT (subtle, desktop only)
     ================================================================== */
  safe('tilt', function () {
    if (isTouch || reduceMotion) return;
    $$('[data-tilt]').forEach(function (el) {
      on(el, 'mousemove', function (e) {
        var r = el.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width - 0.5;
        var py = (e.clientY - r.top) / r.height - 0.5;
        el.style.transform = 'perspective(900px) rotateY(' + (px * 5).toFixed(2) + 'deg) rotateX(' + (-py * 5).toFixed(2) + 'deg) translateY(-6px)';
      });
      on(el, 'mouseleave', function () { el.style.transform = ''; });
    });
  });

  /* ==================================================================
     24b. MENU — bar / food tabs
     ================================================================== */
  safe('menuTabs', function () {
    var btns = $$('[data-menu-tab]');
    if (!btns.length) return;

    btns.forEach(function (btn) {
      on(btn, 'click', function () {
        var key = btn.getAttribute('data-menu-tab');
        btns.forEach(function (b) {
          var active = b === btn;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        $$('[data-menu-panel]').forEach(function (p) {
          p.hidden = p.getAttribute('data-menu-panel') !== key;
        });
      });
    });
  });

  /* ==================================================================
     24c. MENU LANGUAGE — English / Arabic

     Every translatable element carries both data-en and data-ar, with the
     English written into the markup, so the menu is readable before any
     script runs. The direction flips on <main> rather than <html>: the
     header, drawer and footer are not translated, and mirroring them
     would just look broken.
     ================================================================== */
  safe('menuLang', function () {
    var btns = $$('[data-lang]');
    if (!btns.length) return;

    var KEY = 'tr-menu-lang';
    var scope = $('main') || document.body;

    function apply(lang) {
      var ar = lang === 'ar';

      scope.setAttribute('lang', ar ? 'ar' : 'en');
      scope.setAttribute('dir', ar ? 'rtl' : 'ltr');

      $$('[data-en]', scope).forEach(function (el) {
        var v = el.getAttribute(ar ? 'data-ar' : 'data-en');
        if (v !== null) el.textContent = v;
      });

      btns.forEach(function (b) {
        var active = b.getAttribute('data-lang') === lang;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-pressed', active ? 'true' : 'false');
      });

      try { localStorage.setItem(KEY, lang); } catch (e) {}
    }

    btns.forEach(function (b) {
      on(b, 'click', function () { apply(b.getAttribute('data-lang')); });
    });

    var saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) {}
    if (saved === 'ar') apply('ar');
  });

  /* ==================================================================
     25. HERO VIDEO
     The source is attached here rather than in the markup, so the file is
     only ever fetched when it is actually going to be watched. Phones,
     data-saver users and anyone asking for reduced motion keep the poster.
     ================================================================== */
  function attachSource(video) {
    if (!video || video.getAttribute('data-loaded')) return false;
    var src = video.getAttribute('data-src');
    if (!src) return false;
    var s = document.createElement('source');
    s.src = src;
    s.type = 'video/mp4';
    video.appendChild(s);
    video.setAttribute('data-loaded', '1');
    video.load();
    return true;
  }

  function tryPlay(video) {
    var p = video.play();
    // Browsers may refuse autoplay. That is fine — the poster frame stands in.
    if (p && typeof p.catch === 'function') p.catch(function () {});
  }

  function dataSaver() {
    var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!c) return false;
    return !!c.saveData || /^(slow-)?2g$/.test(c.effectiveType || '');
  }

  safe('heroVideo', function () {
    var video = $('[data-hero-video]');
    if (!video) return;
    if (reduceMotion || dataSaver() || window.innerWidth < 760) return;
    if (attachSource(video)) tryPlay(video);
  });

  /* ==================================================================
     26. REELS — load and play only while on screen
     ================================================================== */
  safe('reels', function () {
    var reels = $$('[data-reel]');
    if (!reels.length) return;

    // Without IntersectionObserver the poster frames carry the section.
    if (!('IntersectionObserver' in window) || dataSaver()) return;

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var v = en.target;
        var card = v.closest('.reel');
        if (en.isIntersecting) {
          attachSource(v);
          if (!reduceMotion) { tryPlay(v); if (card) card.classList.add('is-playing'); }
        } else {
          v.pause();
          if (card) card.classList.remove('is-playing');
        }
      });
    }, { threshold: 0.35 });

    reels.forEach(function (v) { io.observe(v); });

    // Pause everything when the tab is hidden so we never decode in the background.
    on(document, 'visibilitychange', function () {
      if (!document.hidden) return;
      reels.forEach(function (v) { v.pause(); });
      $$('.reel').forEach(function (c) { c.classList.remove('is-playing'); });
    });
  });

})();
