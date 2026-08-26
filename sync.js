// =============================================================
// Shared cloud-sync helper. Each page calls initCloudSync({...}).
//
// Reconciliation is per key, not per prefix. The old version replaced
// the whole prefix with whatever the server held and deleted any local
// key the server didn't have, so two devices open across the 6 AM
// rollover could erase each other's day. Now every synced key carries
// its own updatedAt and is merged on its own; list-shaped keys merge
// item by item so two devices editing different tasks on the same day
// both keep their edit.
// =============================================================
(function () {
  'use strict';
  const SUPABASE_URL = 'https://itidzioouqjbwnyvekkw.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_Eb38zFsU1V6OUxXzFd8ysg_AgMn6Zzt';

  const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

  // Pages that track several independent app_state rows (e.g. main.html's
  // goals/weekplan/health) call initCloudSync() more than once. Each call
  // used to spin up its own supabase.createClient(), which meant multiple
  // GoTrueClient auth instances fighting over the same storage key
  // ("Multiple GoTrueClient instances detected" console warning). Share one
  // client per page instead — every initCloudSync() call reuses it.
  let sharedClient = null;
  function getClient() {
    if (!sharedClient) sharedClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    return sharedClient;
  }

  // ---------- page-wide sync status ----------
  // One status for the whole page rather than per channel: the user cares
  // whether their data is getting out, not which of five rows failed.
  const status = { lastSyncedAt: null, failed: false };
  window.SyncStatus = status;
  function setStatus(ok) {
    if (ok) { status.lastSyncedAt = Date.now(); status.failed = false; }
    else { status.failed = true; }
    try { window.dispatchEvent(new CustomEvent('sync-status', { detail: { ok: ok } })); } catch (e) {}
  }

  function rawGet(k) {
    try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; }
  }

  // A legacy item with no id gets one derived from its text rather than a
  // random one: two devices backfilling the same untouched list have to
  // arrive at the SAME id, or the merge sees two different items and the
  // night routine doubles to eighteen entries. Derived once, then persisted,
  // so a later rename still tracks as the same item.
  function derivedId(item) {
    const basis = String((item && (item.text || item.title || item.name)) || '');
    let h = 5381;
    for (let i = 0; i < basis.length; i++) h = ((h * 33) ^ basis.charCodeAt(i)) >>> 0;
    return 'l' + h.toString(36);
  }
  function itemId(item) {
    if (item && typeof item === 'object' && item.id) return String(item.id);
    return derivedId(item);
  }
  // Only merge item-by-item when both sides really are lists of objects.
  // Anything else (a settings blob, an array of plain strings) falls back
  // to newest-key-wins, which is the correct answer for a value that has
  // no addressable parts.
  function isItemList(v) {
    return Array.isArray(v) && v.every(function (x) { return x && typeof x === 'object' && !Array.isArray(x); });
  }

  window.initCloudSync = function (config) {
    const appKey = config && config.appKey;
    const syncedKeys = (config && config.syncedKeys) || [];
    const syncedPrefixes = (config && config.syncedPrefixes) || [];
    const onApplied = config && config.onApplied;
    if (!appKey || !window.supabase) return;
    if (!SUPABASE_URL || !SUPABASE_KEY) return;
    if (SUPABASE_URL.indexOf('PASTE-') === 0 || SUPABASE_KEY.indexOf('PASTE-') === 0) return;

    let supa = null, pushTimer = null, suppressSync = false, lastSyncedJson = null;

    const META_KEY = 'sync:updated:' + appKey;

    function matches(k) {
      if (!k) return false;
      if (syncedKeys.indexOf(k) !== -1) return true;
      for (let i = 0; i < syncedPrefixes.length; i++) {
        if (k.indexOf(syncedPrefixes[i]) === 0) return true;
      }
      return false;
    }
    // The tombstone bucket a key belongs to — its prefix when it has one,
    // otherwise the key itself (a standalone syncedKey like po_water_v1).
    function bucketOf(k) {
      for (let i = 0; i < syncedPrefixes.length; i++) {
        if (k.indexOf(syncedPrefixes[i]) === 0) return syncedPrefixes[i];
      }
      return k;
    }

    // ---------- metadata: per-key updatedAt ----------
    function loadMeta() {
      const m = rawGet(META_KEY);
      return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};
    }
    function saveMeta(m) {
      try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch (e) {}
    }
    function touchKey(k, ts) {
      const m = loadMeta();
      m[k] = ts || Date.now();
      saveMeta(m);
    }

    // ---------- tombstones: deleted:<prefix> ----------
    function loadTomb(bucket) {
      const t = rawGet('deleted:' + bucket);
      const out = (t && typeof t === 'object' && !Array.isArray(t)) ? t : {};
      if (!out.keys || typeof out.keys !== 'object') out.keys = {};
      if (!out.items || typeof out.items !== 'object') out.items = {};
      return out;
    }
    function saveTomb(bucket, t) {
      try { localStorage.setItem('deleted:' + bucket, JSON.stringify(t)); } catch (e) {}
    }
    function pruneTomb(t) {
      const cutoff = Date.now() - TOMBSTONE_TTL_MS;
      ['keys', 'items'].forEach(function (side) {
        Object.keys(t[side]).forEach(function (id) {
          if (!(t[side][id] > cutoff)) delete t[side][id];
        });
      });
      return t;
    }
    function tombstoneKey(k) {
      const b = bucketOf(k);
      const t = pruneTomb(loadTomb(b));
      t.keys[k] = Date.now();
      saveTomb(b, t);
    }
    function tombstoneItems(k, ids) {
      if (!ids.length) return;
      const b = bucketOf(k);
      const t = pruneTomb(loadTomb(b));
      const now = Date.now();
      ids.forEach(function (id) { t.items[id] = now; });
      saveTomb(b, t);
    }
    function allTombs() {
      const out = {};
      const buckets = syncedPrefixes.concat(syncedKeys);
      buckets.forEach(function (b) { out[b] = pruneTomb(loadTomb(b)); });
      return out;
    }
    function mergeTombsIn(remoteTombs) {
      if (!remoteTombs || typeof remoteTombs !== 'object') return;
      Object.keys(remoteTombs).forEach(function (b) {
        const incoming = remoteTombs[b];
        if (!incoming || typeof incoming !== 'object') return;
        const t = pruneTomb(loadTomb(b));
        ['keys', 'items'].forEach(function (side) {
          const src = incoming[side];
          if (!src || typeof src !== 'object') return;
          Object.keys(src).forEach(function (id) {
            const ts = src[id];
            if (typeof ts === 'number' && ts > (t[side][id] || 0)) t[side][id] = ts;
          });
        });
        saveTomb(b, pruneTomb(t));
      });
    }

    function listAllKeys() {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (matches(k)) out.push(k);
      }
      return out;
    }
    function collect() {
      const out = {};
      for (const k of listAllKeys()) {
        const v = localStorage.getItem(k);
        if (v == null) continue;
        try { out[k] = JSON.parse(v); } catch (e) { out[k] = v; }
      }
      return out;
    }

    const origSet = localStorage.setItem.bind(localStorage);
    const origRemove = localStorage.removeItem.bind(localStorage);
    localStorage.setItem = function (k, v) {
      let goneIds = null;
      // Read the outgoing value before it's overwritten: an item that
      // vanishes from a list is a deletion, and this is the only place
      // that is observable — the caller just hands us the new array.
      if (!suppressSync && matches(k)) {
        try {
          const before = rawGet(k);
          const after = JSON.parse(v);
          if (isItemList(before) && isItemList(after)) {
            const keep = new Set(after.map(itemId));
            goneIds = before.map(itemId).filter(function (id) { return !keep.has(id); });
          }
        } catch (e) {}
      }
      origSet(k, v);
      try {
        if (!suppressSync && matches(k)) {
          if (goneIds && goneIds.length) tombstoneItems(k, goneIds);
          touchKey(k);
          schedulePush();
        }
      } catch (e) {}
    };
    localStorage.removeItem = function (k) {
      const wasMatched = !suppressSync && matches(k);
      origRemove(k);
      try {
        if (wasMatched) {
          tombstoneKey(k);
          const m = loadMeta(); delete m[k]; saveMeta(m);
          schedulePush();
        }
      } catch (e) {}
    };

    // Merge one list key item by item. Ties keep the local copy, so a
    // device that is merely out of date never overwrites a fresh edit.
    function mergeList(localList, remoteList, localTs, remoteTs, tomb) {
      const byId = new Map();
      function add(list, ts) {
        if (!Array.isArray(list)) return;
        list.forEach(function (item) {
          const id = itemId(item);
          const killedAt = tomb.items[id];
          if (killedAt && killedAt > ts) return;
          const prev = byId.get(id);
          if (!prev || ts > prev.ts) {
            const copy = Object.assign({}, item);
            if (!copy.id) copy.id = id;
            byId.set(id, { item: copy, ts: ts });
          }
        });
      }
      add(localList, localTs);
      add(remoteList, remoteTs);
      const out = [];
      byId.forEach(function (v) { out.push(v.item); });
      return out;
    }

    function applyRemote(payload) {
      if (!payload || typeof payload !== 'object') return false;
      const meta = payload.__sync || {};
      const remoteUpdated = (meta.updatedAt && typeof meta.updatedAt === 'object') ? meta.updatedAt : {};
      mergeTombsIn(meta.deleted);

      const localUpdated = loadMeta();
      suppressSync = true;
      let changed = false;
      try {
        const keys = new Set();
        Object.keys(payload).forEach(function (k) { if (k !== '__sync' && matches(k)) keys.add(k); });
        listAllKeys().forEach(function (k) { keys.add(k); });

        keys.forEach(function (k) {
          const tomb = loadTomb(bucketOf(k));
          const localTs = localUpdated[k] || 0;
          const remoteTs = remoteUpdated[k] || 0;
          const hasRemote = Object.prototype.hasOwnProperty.call(payload, k);
          const localRaw = localStorage.getItem(k);
          const localVal = localRaw == null ? undefined : rawGet(k);
          const remoteVal = hasRemote ? payload[k] : undefined;

          // A key deleted anywhere stays deleted until the tombstone
          // expires — otherwise a device that has been closed for a week
          // hands back every task you cleared while it was away.
          const killedAt = tomb.keys[k] || 0;
          if (killedAt && killedAt >= Math.max(localTs, remoteTs)) {
            if (localRaw != null) { try { origRemove(k); changed = true; } catch (e) {} }
            return;
          }

          let next;
          if (isItemList(localVal) && isItemList(remoteVal)) {
            next = mergeList(localVal, remoteVal, localTs, remoteTs, tomb);
          } else if (remoteVal === undefined) {
            return; // local-only key: keep it, the push below carries it up
          } else if (localVal === undefined) {
            next = remoteVal;
          } else {
            next = remoteTs > localTs ? remoteVal : localVal;
          }

          const encoded = JSON.stringify(next);
          if (localRaw !== encoded) {
            try {
              origSet(k, encoded);
              localUpdated[k] = Math.max(localTs, remoteTs) || Date.now();
              changed = true;
            } catch (e) {}
          } else if (remoteTs > localTs) {
            localUpdated[k] = remoteTs;
          }
        });
      } finally { suppressSync = false; }

      saveMeta(localUpdated);
      if (changed && typeof onApplied === 'function') { try { onApplied(); } catch (e) {} }
      return changed;
    }

    function buildPayload() {
      const state = collect();
      state.__sync = { updatedAt: loadMeta(), deleted: allTombs() };
      return state;
    }

    async function pushNow() {
      if (!supa) return;
      const state = buildPayload();
      const json = JSON.stringify(state);
      if (json === lastSyncedJson) return;
      try {
        const { error } = await supa.from('app_state').upsert(
          { key: appKey, data: state, updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        );
        if (error) { setStatus(false); return; }
        lastSyncedJson = json;
        setStatus(true);
      } catch (e) {
        setStatus(false);
      }
    }
    function schedulePush() { clearTimeout(pushTimer); pushTimer = setTimeout(pushNow, 250); }
    function flushOnUnload() {
      const state = buildPayload();
      const json = JSON.stringify(state);
      if (json === lastSyncedJson) return;
      try {
        fetch(SUPABASE_URL + '/rest/v1/app_state?on_conflict=key', {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates',
          },
          body: JSON.stringify({ key: appKey, data: state, updated_at: new Date().toISOString() }),
          keepalive: true,
        }).catch(() => {});
        lastSyncedJson = json;
      } catch (e) {}
    }
    (async function init() {
      supa = getClient();
      try {
        const { data, error } = await supa.from('app_state').select('data').eq('key', appKey).maybeSingle();
        if (error) {
          setStatus(false);
        } else if (data && data.data && Object.keys(data.data).length > 0) {
          applyRemote(data.data);
          setStatus(true);
          // The merge result is almost never byte-identical to what the
          // server held, so push it back rather than leaving the other
          // device to rediscover it.
          schedulePush();
        } else {
          setStatus(true);
          if (Object.keys(collect()).length > 0) schedulePush();
        }
      } catch (e) {
        setStatus(false);
      }
      supa.channel('app_state_' + appKey)
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'app_state', filter: 'key=eq.' + appKey,
        }, (payload) => {
          if (!payload.new || !payload.new.data) return;
          const incoming = JSON.stringify(payload.new.data);
          if (incoming === lastSyncedJson) return;
          applyRemote(payload.new.data);
        })
        .subscribe();
    })();
    window.addEventListener('beforeunload', flushOnUnload);
    window.addEventListener('pagehide', flushOnUnload);
    window.addEventListener('storage', (e) => { if (e.key && matches(e.key)) schedulePush(); });
  };
})();
