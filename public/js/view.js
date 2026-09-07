"use strict";
(function () {
  const token = location.pathname.replace(/^\/share\//, "").replace(/\/$/, "");
  let projectName = "Shortplanner";
  let activeTab = "stripboard";
  let activeCsDayLabel = "";
  let bootVersion = null;

  /* Versionskoll -- samma idé som i den inloggade appen: serverns build-id
     kommer med som X-App-Version, och pollas via /api/version vid fokus/
     online/var 10:e min. Skiljer det sig från vad sidan startade med ->
     "ladda om"-banner. */
  async function fetchVersion() {
    try {
      const r = await fetch("/api/version", { cache: "no-store" });
      if (!r.ok) return null;
      return (await r.json()).version || null;
    } catch (e) { return null; }
  }
  function showUpdateBar() { document.getElementById("updateBar").classList.remove("hidden"); }
  function noteVersion(v) {
    if (!v) return;
    if (!bootVersion) { bootVersion = v; return; }
    if (v !== bootVersion) {
      showUpdateBar();
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage("refreshShell");
      }
    }
  }
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(function () {});
    navigator.serviceWorker.addEventListener("message", function (e) {
      if (e.data && e.data.type === "shell-updated") showUpdateBar();
    });
    checkShellFreshness();
  }
  /* Se app.js: jämför det CACHADE skalets build-id mot /api/version så en
     stale service-worker-cache upptäcks efter en deploy. */
  async function checkShellFreshness() {
    try {
      if (!("caches" in window)) return;
      const shells = (await caches.keys()).filter(function (k) { return k.indexOf("sp-shell-") === 0; });
      if (!shells.length) return;
      const srv = await fetchVersion();
      if (!srv) return;
      const stale = shells.some(function (k) { const id = k.slice("sp-shell-".length); return id !== "boot" && id !== srv; });
      if (stale) {
        if (navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage("refreshShell");
        showUpdateBar();
      }
    } catch (e) { /* ignoreras */ }
  }
  registerServiceWorker();

  /* Sidtiteln styr både flikrubriken och webbläsarens föreslagna filnamn
     vid utskrift/spara som PDF — speglar därför vad man faktiskt ser. */
  function updateTitle() {
    if (activeTab === "callsheet" && activeCsDayLabel) {
      document.title = `${projectName} – Call sheet – ${activeCsDayLabel}`;
    } else if (activeTab === "stripboard") {
      document.title = `${projectName} – Stripboard`;
    } else if (activeTab === "manus") {
      document.title = `${projectName} – Manus`;
    } else if (activeTab === "sides") {
      document.title = `${projectName} – Dagsmanus`;
    } else if (activeTab === "rullplan") {
      document.title = `${projectName} – Rullplan`;
    } else {
      document.title = projectName;
    }
  }

  function firstVisibleTab() {
    const t = document.querySelector('#viewTabbar .tab:not([hidden])');
    return t ? t.dataset.tab : "stripboard";
  }
  function setTab(name) {
    const target = document.querySelector('#viewTabbar .tab[data-tab="' + name + '"]');
    if (!target || target.hidden) name = firstVisibleTab();
    activeTab = name;
    document.querySelectorAll("#viewTabbar .tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
    ["stripboard", "callsheet", "manus", "sides", "rullplan"].forEach(n =>
      document.getElementById("view-" + n).classList.toggle("active", n === name));
    /* Samma nollställning som i den inloggade appen -- ny flik ska visas
       högst upp, inte kvar på gamla flikens scrollposition. */
    window.scrollTo(0, 0);
    /* Manus/Dagsmanus/Rullplan ritas om vid varje flikbyte, samma anledning
       som i den inloggade appen: båda är härledda direkt ur stripboardet,
       inte en sparad kopia. */
    if (name === "manus") SC.refreshManus();
    if (name === "sides") SC.refreshSides();
    if (name === "rullplan") SC.refreshRullplan();
    updateTitle();
  }
  window.viewSetTab = setTab;

  let currentData = null;
  let lastUpdatedAt = null;

  function two(n) { return String(n).padStart(2, "0"); }
  function renderFreshness(stale) {
    const el = document.getElementById("shareFreshness");
    if (!el) return;
    el.classList.remove("hidden");
    const t = lastUpdatedAt ? new Date(lastUpdatedAt) : null;
    const hhmm = t && !isNaN(+t) ? two(t.getHours()) + ":" + two(t.getMinutes()) : "?";
    if (stale) {
      el.classList.add("is-stale");
      el.innerHTML = "Innehållet har uppdaterats sedan du öppnade sidan · ";
      const b = document.createElement("button");
      b.type = "button"; b.textContent = "visa senaste";
      b.onclick = () => refreshData(true);
      el.appendChild(b);
    } else {
      el.classList.remove("is-stale");
      el.textContent = "Uppdaterad " + hhmm;
    }
  }

  /* Monterar (eller ommonterar) alla vyer från ett datasvar. getStripboard
     läser currentData så Manus/Dagsmanus/Rullplan speglar ev. ny data efter
     en refresh. Vid refresh behålls aktiv flik och scrollposition rörs inte. */
  function applyData(d, isRefresh) {
    currentData = d;
    lastUpdatedAt = d.updatedAt || null;
    projectName = d.project.name;
    document.getElementById("viewTitle").textContent = d.project.name;
    /* Två saker gömmer en flik i delade vyn:
       1. sajtens feature-flaggor (rullplan/dpr/manus avstängda globalt)
       2. vilka komponenter just den här delningslänken valt att visa
          (d.components; saknas → alla, bakåtkompatibelt). */
    const f = (d.site && d.site.features) || {};
    const comps = Array.isArray(d.components) ? d.components : ["stripboard", "callsheet", "manus", "sides", "rullplan"];
    document.querySelectorAll("#viewTabbar .tab").forEach(tab => {
      const k = tab.dataset.tab;
      const featureKey = (k === "sides") ? "manus" : k;
      const offByFeature = f[featureKey] === false;
      const offByShare = !comps.includes(k);   // dpr finns inte i comps → alltid dold (som förr)
      tab.hidden = offByFeature || offByShare;
    });
    SB.mount(document.getElementById("view-stripboard"), d.stripboard, { readOnly: true });
    CS.mount(document.getElementById("view-callsheet"), d.callsheet, {
      readOnly: true,
      shareUrl: location.origin + location.pathname,
      onDayChange: (day) => { activeCsDayLabel = day.label; updateTitle(); },
      logoUrl: (d.site && d.site.hasLogo) ? "/logo" : null,
      companyName: (d.site && d.site.company && d.site.company.name) || ""
    });
    SC.mount(document.getElementById("view-manus"), d.script, { readOnly: true, getStripboard: () => currentData.stripboard });
    SC.mountSides(document.getElementById("view-sides"), d.script, { readOnly: true, getStripboard: () => currentData.stripboard });
    SC.mountRullplan(document.getElementById("view-rullplan"), d.script, { readOnly: true, getStripboard: () => currentData.stripboard });
    setTab(isRefresh ? activeTab : "stripboard");
    document.getElementById("viewLoading").classList.add("hidden");
    document.getElementById("viewApp").classList.remove("hidden");
    if (!isRefresh) requestAnimationFrame(() => SB.scrollToClosestDay());
    renderFreshness(false);
  }

  /* Hämtar om delade datat. force=true monterar alltid om (knapptryck).
     Annars: ändrat + fliken dold -> montera om tyst; ändrat + fliken synlig
     -> visa "visa senaste"-raden istället för att rycka undan sidan. */
  function refreshData(force) {
    return fetch("/api/share/" + encodeURIComponent(token), { credentials: "same-origin", cache: "no-store" })
      .then(r => { noteVersion(r.headers.get("X-App-Version")); return r.ok ? r.json() : null; })
      .then(d => {
        if (!d) return;
        const changed = d.updatedAt && d.updatedAt !== lastUpdatedAt;
        if (force || (changed && document.hidden)) applyData(d, true);
        else if (changed) renderFreshness(true);
      })
      .catch(() => {});
  }

  fetch("/api/share/" + encodeURIComponent(token), { credentials: "same-origin" })
    .then(r => {
      noteVersion(r.headers.get("X-App-Version"));
      if (!r.ok) throw new Error(r.status === 404 ? "Länken är ogiltig eller har tagits bort." : "Kunde inte ladda (fel " + r.status + ").");
      return r.json();
    })
    .then(d => applyData(d, false))
    .catch(err => {
      document.getElementById("viewLoading").classList.add("hidden");
      const e = document.getElementById("viewError");
      e.textContent = err.message;
      e.classList.remove("hidden");
    });

  fetchVersion().then(noteVersion);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    fetchVersion().then(noteVersion);
    refreshData(false);
  });
  window.addEventListener("online", () => { fetchVersion().then(noteVersion); refreshData(false); });
  setInterval(() => fetchVersion().then(noteVersion), 10 * 60 * 1000);
  setInterval(() => refreshData(false), 3 * 60 * 1000);
})();
