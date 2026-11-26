/* Nebula — featured carousel on the Jellyfin home page.
   Loaded from index.html (see install/inject-docker.sh). Only reads the API using the user's session. */
(function () {
  'use strict';
  /* The Jellyfin iOS app (WKWebView) can get stuck in a reload loop with the carousel, so it is not loaded on iOS. */
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)) return;
  /* Settings: read from CSS variables (put them in "Custom CSS", see README) or from window.NebulaHero.
     Example:  :root { --nb-hero-count: 10; --nb-hero-source: toprated; --nb-hero-library: "Movies"; } */
  var DEF = {
    count: 8,                 // titles in the carousel (0 = no carousel)
    interval: 8,              // seconds between slides (0 = no auto-advance)
    source: 'recent',         // recent | random | toprated | favorites
    types: 'Movie,Series',    // Movie, Series or both
    library: '',              // comma-separated library name(s); empty = all
    days: 120,                // only items added in the last N days (source=recent); 0 = no limit
    unwatched: 1,             // 1 = unwatched only
    logo: 1,                  // 1 = only titles with a logo; 0 = also without (shows the name)
    overview: 1, genres: 1, rating: 1,
    buttons: 1,               // "Play now" / "More info" buttons
    play: 1                   // 1 = "Play now" starts playback directly
  };
  var cache = null, cacheKey = null, cacheAt = 0;

  function cfg() {
    var c = {}, st = getComputedStyle(document.documentElement), ext = window.NebulaHero || {};
    Object.keys(DEF).forEach(function (k) {
      var v = ext[k] != null ? String(ext[k]) : st.getPropertyValue('--nb-hero-' + k).trim().replace(/^["']|["']$/g, '');
      if (v === '') { c[k] = DEF[k]; return; }
      c[k] = typeof DEF[k] === 'number' ? (parseFloat(v) || 0) : v;
    });
    return c;
  }

  function api() { return window.ApiClient; }
  function enHome() { if (/[?&]tab=[1-9]/.test(location.hash)) return false; return /^#\/home(\.html)?(\?|$)/.test(location.hash) || location.hash === '' || location.hash === '#/'; }

  function img(id, tipo, extra) {
    return api().getUrl('Items/' + id + '/Images/' + tipo + (extra || ''), { quality: 90, maxWidth: tipo === 'Logo' ? 700 : 1920 });
  }

  function bibliotecas(c, uid) {
    if (!c.library) return Promise.resolve([null]);
    var want = c.library.split(',').map(function (x) { return x.trim().toLowerCase(); });
    return api().getJSON(api().getUrl('Users/' + uid + '/Views')).then(function (r) {
      var ids = (r.Items || []).filter(function (v) { return want.indexOf((v.Name || '').toLowerCase()) >= 0; }).map(function (v) { return v.Id; });
      if (!ids.length) console.warn('[NebulaHero] library not found:', c.library);
      return ids.length ? ids : [null];
    });
  }

  // score for "toprated": average of audience and critic ratings; no critic rating (few votes) is penalized
  function nota(i) { var p = i.CommunityRating || 0; return i.CriticRating ? (p + i.CriticRating / 10) / 2 : p - 2; }

  function cargar(c) {
    var a = api(), uid = a.getCurrentUserId(), key = uid + JSON.stringify(c);
    if (cache && cacheKey === key && Date.now() - cacheAt < 10 * 60 * 1000) return Promise.resolve(cache);
    var orden = { recent: 'DateCreated', toprated: 'CommunityRating', random: 'Random', favorites: 'Random' }[c.source] || 'DateCreated';
    return bibliotecas(c, uid).then(function (libs) {
      return Promise.all(libs.map(function (lib) {
        var q = {
          Recursive: true, IncludeItemTypes: c.types, ImageTypes: c.logo ? 'Backdrop,Logo' : 'Backdrop',
          Fields: 'Overview,Genres,ProductionYear,CommunityRating,OfficialRating,RunTimeTicks,ChildCount,ImageTags,BackdropImageTags,UserData',
          HasOverview: true, Limit: c.source === 'toprated' ? 150 : 40, SortBy: orden, SortOrder: 'Descending'
        };
        if (c.unwatched) q.IsPlayed = false;
        if (c.source === 'favorites') q.IsFavorite = true;
        if (c.source === 'recent' && c.days > 0) q.MinDateLastSaved = new Date(Date.now() - c.days * 864e5).toISOString();
        if (lib) q.ParentId = lib;
        return a.getJSON(a.getUrl('Users/' + uid + '/Items', q)).then(function (r) { return r.Items || []; });
      }));
    }).then(function (listas) {
      var items = [].concat.apply([], listas).filter(function (i) {
        return i.BackdropImageTags && i.BackdropImageTags.length && (!c.logo || (i.ImageTags && i.ImageTags.Logo));
      });
      // recent: shuffle favoring high ratings; toprated: by score; random/favorites: random
      if (c.source === 'toprated') items.sort(function (x, y) { return nota(y) - nota(x); });
      else if (c.source === 'recent') items.sort(function (x, y) { return (y.CommunityRating || 0) - (x.CommunityRating || 0) + (Math.random() - .5) * 3; });
      else items.sort(function () { return Math.random() - .5; });
      cache = items.slice(0, Math.max(1, c.count)); cacheKey = key; cacheAt = Date.now();
      return cache;
    });
  }

  function dur(t) { if (!t) return ''; var m = Math.round(t / 6e8); return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min'; }
  function esc(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function construir(items, c) {
    var sid = api().serverId();
    var el = document.createElement('section');
    el.className = 'nbHero';
    el.innerHTML =
      '<div class="nbHero-slides">' + items.map(function (i, n) {
        var meta = [i.ProductionYear, i.Type === 'Series' ? (i.ChildCount ? i.ChildCount + (i.ChildCount === 1 ? ' season' : ' seasons') : 'Series') : dur(i.RunTimeTicks), i.OfficialRating]
          .filter(Boolean).map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('');
        if (c.rating && i.CommunityRating) meta += '<span class="nbHero-star">★ ' + i.CommunityRating.toFixed(1) + '</span>';
        var gen = (c.genres ? i.Genres || [] : []).slice(0, 3).map(function (g) { return '<span class="nbHero-chip">' + esc(g) + '</span>'; }).join('');
        var url = '#/details?id=' + i.Id + '&serverId=' + sid;
        return '<article class="nbHero-slide' + (n === 0 ? ' is-active' : '') + '" data-i="' + n + '">' +
          '<div class="nbHero-bg" style="background-image:url(\'' + img(i.Id, 'Backdrop', '/0') + '\')"></div>' +
          '<div class="nbHero-shade"></div>' +
          '<div class="nbHero-body">' +
            (i.ImageTags && i.ImageTags.Logo ? '<img class="nbHero-logo" alt="' + esc(i.Name) + '" src="' + img(i.Id, 'Logo') + '">' : '<h2 class="nbHero-title">' + esc(i.Name) + '</h2>') +
            '<div class="nbHero-meta">' + meta + '</div>' +
            '<div class="nbHero-genres">' + gen + '</div>' +
            (c.overview ? '<p class="nbHero-overview">' + esc(i.Overview) + '</p>' : '') +
            (!c.buttons ? '' : '<div class="nbHero-actions">' +
              '<a class="nbHero-btn nbHero-btn--main" data-play="' + i.Id + '" href="' + url + '"><span class="material-icons">play_arrow</span>Play now</a>' +
              '<a class="nbHero-btn" href="' + url + '"><span class="material-icons">info_outline</span>More info</a>' +
            '</div>') +
          '</div></article>';
      }).join('') + '</div>' +
      '<button class="nbHero-nav nbHero-prev" aria-label="Previous"><span class="material-icons">chevron_left</span></button>' +
      '<button class="nbHero-nav nbHero-next" aria-label="Next"><span class="material-icons">chevron_right</span></button>' +
      '<div class="nbHero-dots">' + items.map(function (_, n) { return '<button class="nbHero-dot' + (n === 0 ? ' is-active' : '') + '" data-i="' + n + '" aria-label="Go to slide ' + (n + 1) + '"><i></i></button>'; }).join('') + '</div>';

    var actual = 0, timer = null, slides = el.querySelectorAll('.nbHero-slide'), dots = el.querySelectorAll('.nbHero-dot');
    function ir(n) {
      n = (n + slides.length) % slides.length;
      slides[actual].classList.remove('is-active'); dots[actual].classList.remove('is-active');
      actual = n;
      slides[actual].classList.add('is-active');
      dots[actual].classList.remove('is-active'); void dots[actual].offsetWidth; dots[actual].classList.add('is-active');
    }
    var INTERVALO = c.interval * 1000;
    if (!INTERVALO) el.classList.add('is-static');
    function play() { stop(); if (!INTERVALO) return; timer = setInterval(function () { if (!document.hidden && document.body.contains(el)) ir(actual + 1); else if (!document.body.contains(el)) stop(); }, INTERVALO); el.classList.remove('is-paused'); }
    function stop() { if (timer) clearInterval(timer); timer = null; }
    el.querySelector('.nbHero-prev').onclick = function () { ir(actual - 1); play(); };
    el.querySelector('.nbHero-next').onclick = function () { ir(actual + 1); play(); };
    dots.forEach(function (d) { d.onclick = function () { ir(+d.dataset.i); play(); }; });
    el.addEventListener('mouseenter', function () { stop(); el.classList.add('is-paused'); });
    el.addEventListener('mouseleave', play);
    var x0 = null;
    el.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    el.addEventListener('touchend', function (e) { if (x0 === null) return; var dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) { ir(actual + (dx < 0 ? 1 : -1)); play(); } x0 = null; });
    if (c.play) el.querySelectorAll('[data-play]').forEach(function (b) { b.addEventListener('click', function () { try { sessionStorage.setItem('nbAutoplay', b.dataset.play); } catch (e) {} }); });
    el.style.setProperty('--nb-int', INTERVALO + 'ms');
    play();
    return el;
  }

  var montando = false;
  function montar() {
    if (!enHome() || !api() || !api().getCurrentUserId || !api().getCurrentUserId()) return;
    var page = document.querySelector('.homePage:not(.hide)');
    var cont = page && page.querySelector('.homeSectionsContainer');
    if (!cont || page.querySelector('.nbHero') || montando) return;
    var c = cfg();
    if (c.count <= 0) return;
    montando = true;
    cargar(c).then(function (items) {
      montando = false;
      if (!items.length || page.querySelector('.nbHero')) return;
      cont.parentNode.insertBefore(construir(items, c), cont);
    }).catch(function (e) { montando = false; console.warn('[NebulaHero]', e); });
  }

  // "Play now": when the item page loads, click its play button once
  function autoplay() {
    var id; try { id = sessionStorage.getItem('nbAutoplay'); } catch (e) { return; }
    if (!id || location.hash.indexOf('id=' + id) < 0) return;
    var b = document.querySelector('.itemDetailPage:not(.hide) .mainDetailButtons .btnPlay:not(.hide)');
    if (!b) return;
    try { sessionStorage.removeItem('nbAutoplay'); } catch (e) {}
    setTimeout(function () { b.click(); }, 350);
  }

  // The 12.x admin dashboard doesn't apply the custom CSS, so we inject it ourselves
  var cssPedido = false;
  function cssPanel() {
    if (!/^#\/dashboard|^#\/(users|libraries|plugins|tasks|devices|activity|logs|playback|networking|branding|apikeys|livetv\/)/i.test(location.hash.replace('#!', '#'))) return;
    if (cssPedido || document.getElementById('nbPanelCss')) return;
    var hay = Array.prototype.some.call(document.querySelectorAll('style'), function (s) { return s.id !== 'nbPanelCss' && s.textContent.indexOf('Nebula') >= 0; });
    if (hay) return;
    cssPedido = true;
    fetch(api().getUrl('Branding/Css')).then(function (r) { return r.text(); }).then(function (t) {
      var st = document.createElement('style'); st.id = 'nbPanelCss'; st.textContent = t; document.head.appendChild(st);
    }).catch(function () { cssPedido = false; });
  }

  // Safety net: Jellyfin closes menus and dialogs when their exit animation ends ("animationend").
  // If that animation never finishes (reduced motion, power saving, other CSS…), the menu stayed
  // open covering everything. If it's still there half a second after it started closing, we finish it off.
  document.addEventListener('closing', function (e) {
    var d = e.target;
    if (!d || !d.classList || !d.classList.contains('dialog')) return;
    setTimeout(function () {
      if (d.isConnected && !d.classList.contains('hide')) d.dispatchEvent(new Event('animationend'));
    }, 500);
  }, true);

  // Jellyfin 12 bug: the new menus (MUI: "More", user, dashboard…) don't close with the Back button.
  // Navigating changed the page but the menu stayed mounted with an invisible layer blocking all
  // taps (very common with Android Back). On page change, we close them as if the user tapped outside.
  function cerrarMenusMui() {
    Array.prototype.forEach.call(document.querySelectorAll('.MuiModal-root:not(.MuiModal-hidden)'), function (m) {
      var b = m.querySelector('.MuiBackdrop-root');
      if (!b) return;
      ['mousedown', 'mouseup', 'click'].forEach(function (t) { b.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true })); });
    });
  }
  window.addEventListener('popstate', function () { setTimeout(cerrarMenusMui, 0); });
  window.addEventListener('hashchange', function () { setTimeout(cerrarMenusMui, 0); });

  var pend = false;
  new MutationObserver(function () {
    if (pend) return; pend = true;
    // in the background there are no frames (rAF is frozen), so use a timer
    (document.hidden ? function (f) { setTimeout(f, 50); } : requestAnimationFrame)(function () { pend = false; cssPanel(); if (enHome()) montar(); else autoplay(); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('hashchange', function () { cssPanel(); montar(); });
})();
