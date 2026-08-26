// =============================================================
// WATER TRACKER — ported natively from po-water.html (was embedded
// via <iframe src="po-water.html"> until it was inlined here). Same
// markup/CSS/JS as that file, own IIFE, own 'po_water_v1' storage
// key — po-water.html itself is left untouched for anything that
// still links to it directly.
// =============================================================
const CONFIG = {
  appTitle: "Water Coach",

  // Default unit. Options: "bottle" | "glass" | "oz" | "ml"
  unit: "bottle",

  // Volume per "bottle" / "glass" in ml. 500 = standard water bottle,
  // 250 = a typical drinking glass.
  bottleMl: 500,
  glassMl: 250,

  // Default user profile (gets overwritten by what you save in Settings).
  profile: {
    weightKg: 75,
    age: 25,
    sex: "m",            // "m" | "f" | "o"
    activityHrsPerWeek: 5
  },

  // Default daily caffeine in mg (200 mg ≈ two cups of coffee).
  caffeineMgPerDay: 200,

  // Pre-loaded substances. The Settings → Stimulants & meds search uses
  // this list; users can add custom entries with `extraWaterMl` each.
  // Numbers are conservative additions to daily water needs based on
  // peer-reviewed effects (diuresis, dry-mouth, reduced thirst signal,
  // narrow-therapeutic-window safety bumps).
  defaultSubstances: []
};

// Previously running inside an <iframe> (window.self !== window.top told
// it "I'm embedded, keep it to the essential card"). Now that this is
// native DOM in main.html rather than a nested browsing context, that
// check would read as false and the 14-day history card would appear —
// unchanged from how the dashboard has always shown this widget, always
// mark it embedded here instead of feature-detecting an iframe.
document.documentElement.classList.add('is-embedded');

(function() {
  const $ = (id) => document.getElementById(id);

  // ============================================================
  // SUBSTANCE DATABASE — daily water bumps scale with YOUR dose.
  //
  // Each entry has:
  //   unit         — what you measure the dose in (mg, pouches/day, drinks/day…)
  //   defaultDose  — typical adult therapeutic dose (just a starting value)
  //   mlPerUnit    — extra ml of water needed per 1 unit of dose
  //
  // Final water bump for a substance you've added = dose × mlPerUnit.
  // So 36mg Concerta → 36 × 13.9 ≈ 500ml. 18mg Concerta → ≈ 250ml.
  //
  // Numbers based on conservative reads of:
  //   - ADHD stim diuresis + reduced thirst signal (Adler/Wilens reviews)
  //   - Lithium narrow therapeutic window (Cooper 2014, NICE guidelines)
  //   - Thiazide / loop diuretic SE profiles
  //   - Alcohol diuresis (Hobson 2010 — ~10ml urine per gram ethanol)
  // ============================================================
  const SUBSTANCE_DB = [
    { id: 'adderall',    name: 'Adderall (mixed amphetamine salts)', cat: 'ADHD stim',    unit: 'mg',           defaultDose: 20,   mlPerUnit: 25,    note: 'Stim · reduces thirst signal · dries you out' },
    { id: 'concerta',    name: 'Concerta (methylphenidate ER)',      cat: 'ADHD stim',    unit: 'mg',           defaultDose: 36,   mlPerUnit: 13.9,  note: 'Stim · reduces thirst signal' },
    { id: 'vyvanse',     name: 'Vyvanse (lisdexamfetamine)',         cat: 'ADHD stim',    unit: 'mg',           defaultDose: 50,   mlPerUnit: 10,    note: 'Stim prodrug · long acting' },
    { id: 'ritalin',     name: 'Ritalin IR (methylphenidate)',       cat: 'ADHD stim',    unit: 'mg',           defaultDose: 20,   mlPerUnit: 20,    note: 'Short-acting stim' },
    { id: 'focalin',     name: 'Focalin / Focalin XR',               cat: 'ADHD stim',    unit: 'mg',           defaultDose: 20,   mlPerUnit: 20,    note: 'Methylphenidate isomer' },
    { id: 'modafinil',   name: 'Modafinil',                          cat: 'Wakefulness',  unit: 'mg',           defaultDose: 200,  mlPerUnit: 1.75,  note: 'Mild dehydrating effect' },
    { id: 'lithium',     name: 'Lithium',                            cat: 'Mood',         unit: 'mg',           defaultDose: 600,  mlPerUnit: 1.67,  note: 'Critical — narrow therapeutic window, dehydration → toxicity' },
    { id: 'hctz',        name: 'Hydrochlorothiazide (HCTZ)',         cat: 'Diuretic',     unit: 'mg',           defaultDose: 25,   mlPerUnit: 40,    note: 'Direct diuretic — drink to compensate' },
    { id: 'lasix',       name: 'Furosemide (Lasix)',                 cat: 'Diuretic',     unit: 'mg',           defaultDose: 40,   mlPerUnit: 30,    note: 'Loop diuretic · talk to your doctor about target' },
    { id: 'spironol',    name: 'Spironolactone',                     cat: 'Diuretic',     unit: 'mg',           defaultDose: 50,   mlPerUnit: 12,    note: 'K-sparing diuretic' },
    { id: 'sudafed',     name: 'Pseudoephedrine (Sudafed)',          cat: 'Decongestant', unit: 'mg',           defaultDose: 60,   mlPerUnit: 4.17,  note: 'Sympathomimetic · dries mucous membranes' },
    { id: 'phenyl',      name: 'Phenylephrine',                      cat: 'Decongestant', unit: 'mg',           defaultDose: 10,   mlPerUnit: 20,    note: 'Vasoconstrictor — mild' },
    { id: 'nicotine',    name: 'Nicotine pouch (Velo / Zyn)',        cat: 'Stim',         unit: 'pouches/day',  defaultDose: 4,    mlPerUnit: 62.5,  note: 'Vasoconstriction + dry mouth' },
    { id: 'nicpatch',    name: 'Nicotine patch',                     cat: 'Stim',         unit: 'mg',           defaultDose: 14,   mlPerUnit: 18,    note: '24-h transdermal · sustained release' },
    { id: 'alcohol',     name: 'Alcohol',                            cat: 'Depressant',   unit: 'drinks/day',   defaultDose: 1,    mlPerUnit: 400,   note: '~10ml urine per gram ethanol — adds up fast' },
    { id: 'cannabis',    name: 'Cannabis / THC',                     cat: 'Other',        unit: 'sessions/day', defaultDose: 1,    mlPerUnit: 250,   note: 'Cottonmouth — saliva gland inhibition' },
    { id: 'creatine',    name: 'Creatine monohydrate',               cat: 'Supplement',   unit: 'g/day',        defaultDose: 5,    mlPerUnit: 80,    note: 'Pulls water into muscle cells — drink more' },
    { id: 'preworkout',  name: 'Pre-workout (caffeine + others)',    cat: 'Stim',         unit: 'servings/day', defaultDose: 1,    mlPerUnit: 300,   note: 'High-stim formula on top of caffeine' },
    { id: 'metformin',   name: 'Metformin',                          cat: 'Glucose',      unit: 'mg',           defaultDose: 1000, mlPerUnit: 0.3,   note: 'Mild GI fluid loss' },
    { id: 'sertraline',  name: 'SSRI (sertraline / escitalopram / fluoxetine)', cat: 'SSRI', unit: 'mg',         defaultDose: 50,   mlPerUnit: 4,     note: 'Mild dry mouth in some users' },
    { id: 'wellbutrin',  name: 'Bupropion (Wellbutrin)',             cat: 'NDRI',         unit: 'mg',           defaultDose: 300,  mlPerUnit: 1.17,  note: 'Stim-like profile' }
  ];

  // Compute the actual ml/day a saved substance contributes given the user's dose.
  function subExtraMl(s) {
    const dose = (s.dose != null ? s.dose : s.defaultDose) || 0;
    return Math.max(0, dose * (s.mlPerUnit || 0));
  }
  function subDoseLabel(s) {
    const dose = (s.dose != null ? s.dose : s.defaultDose);
    return dose + ' ' + (s.unit || '');
  }

  // ============================================================
  // STATE
  // ============================================================
  const LS_KEY = 'po_water_v1';
  let didMigrateTarget = false;
  function loadState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) {}
    return normalize({});
  }
  function normalize(s) {
    s = s || {};
    s.unit = s.unit || CONFIG.unit || 'bottle';
    s.bottleMl = s.bottleMl || CONFIG.bottleMl || 500;
    s.glassMl  = s.glassMl  || CONFIG.glassMl  || 250;
    s.weightUnit = s.weightUnit || 'kg';
    s.profile = Object.assign({}, CONFIG.profile, s.profile || {});
    s.caffeineMgPerDay = (s.caffeineMgPerDay != null) ? s.caffeineMgPerDay : (CONFIG.caffeineMgPerDay || 200);
    s.substances = Array.isArray(s.substances) ? s.substances : (CONFIG.defaultSubstances || []);
    s.logs = (s.logs && typeof s.logs === 'object') ? s.logs : {};  // {YYYY-MM-DD: number_of_servings}
    // Manual target lets you skip the weight/activity/caffeine calculator
    // and just set a flat daily goal in ml (e.g. "3 litres, full stop").
    s.useManualTarget = !!s.useManualTarget;
    s.manualTargetMl = (s.manualTargetMl != null) ? s.manualTargetMl : 3000;
    // One-time migration: switch the indicator over to a flat 500ml-bottle
    // target of 3L/day (6 bottles) instead of the personalized calculator.
    // Runs once per device — after this, Settings' auto/manual toggle is
    // free to change it again.
    if (!s.targetConfigV2) {
      s.unit = 'bottle';
      s.bottleMl = 500;
      s.useManualTarget = true;
      s.manualTargetMl = 3000;
      s.targetConfigV2 = true;
      didMigrateTarget = true;
    }
    return s;
  }
  function saveState() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {}
  }
  let state = loadState();
  if (didMigrateTarget) saveState();
  $('appTitle').textContent = CONFIG.appTitle || 'Water Coach';

  // Helpers
  function dateKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  function todayKey() { return dateKey(new Date()); }
  function todayCount() { return state.logs[todayKey()] || 0; }
  function setTodayCount(n) {
    const k = todayKey();
    if (n <= 0) delete state.logs[k];
    else state.logs[k] = n;
    saveState();
  }

  // ============================================================
  // CALCULATOR — daily water target in ml
  //
  //   base_ml    = weight_kg × 35 ml      (NAM/IOM standard)
  //   exercise   = activity_hrs/wk ÷ 7 × 500 ml/day   (≈500 ml/hr training)
  //   caffeine   = max(0, caffeineMg − 200) × 1.5 ml  (mild diuresis)
  //   substances = sum of extraMl for each added med/stim
  //   adjustments: +200 ml male, +100 ml age 50+
  // ============================================================
  function computeTargetMl() {
    if (state.useManualTarget) {
      const manual = state.manualTargetMl || 0;
      return { manual: true, base: manual, exercise: 0, caffeine: 0, subs: 0, adjust: 0, total: manual };
    }
    const p = state.profile;
    const wKg = state.weightUnit === 'lb' ? p.weightKg / 2.20462 : p.weightKg;
    const base = wKg * 35;
    const exercise = (p.activityHrsPerWeek || 0) / 7 * 500;
    const caffeine = Math.max(0, (state.caffeineMgPerDay || 0) - 200) * 1.5;
    const subs = (state.substances || []).reduce((s, x) => s + subExtraMl(x), 0);
    let adjust = 0;
    if (p.sex === 'm') adjust += 200;
    if ((p.age || 0) >= 50) adjust += 100;
    return {
      base, exercise, caffeine, subs, adjust,
      total: base + exercise + caffeine + subs + adjust
    };
  }

  function unitVolMl() {
    if (state.unit === 'bottle') return state.bottleMl || 500;
    if (state.unit === 'glass')  return state.glassMl  || 250;
    if (state.unit === 'oz')     return 30;     // 1 fl oz ≈ 29.57 ml
    return 1;                                   // ml
  }
  function unitLabelPlural() {
    if (state.unit === 'bottle') return 'bottles';
    if (state.unit === 'glass')  return 'glasses';
    if (state.unit === 'oz')     return 'oz';
    return 'ml';
  }
  function unitLabelSingular() {
    if (state.unit === 'bottle') return 'bottle';
    if (state.unit === 'glass')  return 'glass';
    if (state.unit === 'oz')     return 'oz';
    return 'ml';
  }
  function fmtMl(ml) {
    if (ml >= 1000) return (ml / 1000).toFixed(1) + ' L';
    return Math.round(ml) + ' ml';
  }

  // ============================================================
  // RENDER
  // ============================================================
  function renderDayPill() {
    const d = new Date();
    const dows = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
    const mons = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    $('dayPillLabel').textContent = dows[d.getDay()] + ', ' + mons[d.getMonth()] + ' ' + d.getDate();
  }

  function renderWater() {
    const calc = computeTargetMl();
    const targetUnits = Math.ceil(calc.total / unitVolMl());
    const count = todayCount();
    const unitName = unitLabelPlural();

    $('waterUnitLabel').textContent = unitName.toUpperCase() + ' DRANK TODAY';
    $('waterNum').textContent = count;
    $('waterTarget').textContent = '/ ' + targetUnits;
    $('waterPlusLabel').textContent = 'Drank a ' + unitLabelSingular();

    // Progress bar with three zones: low (0-65%), healthy (65-100%), over (100-150%)
    const pctRaw = (count / targetUnits) * 100;
    const fillPct = Math.min(150, pctRaw) / 1.5;   // bar represents 0-150%
    const fill = $('waterBarFill');
    fill.style.width = fillPct + '%';
    fill.classList.toggle('over', pctRaw > 100);
    $('waterBarMin').textContent = '0';
    $('waterBarMax').textContent = (Math.ceil(targetUnits * 1.5)) + '+';
    // Healthy zone bands at 65% and 100%
    $('waterBarZoneStart').style.left = (65 / 1.5) + '%';
    $('waterBarZoneEnd').style.left   = (100 / 1.5) + '%';

    // Helper text
    const helper = $('waterHelper');
    if (count === 0) { helper.textContent = 'Start the day — first one in.'; helper.classList.remove('good'); }
    else if (pctRaw < 50) { helper.textContent = 'Behind pace — drink one in the next hour.'; helper.classList.remove('good'); }
    else if (pctRaw < 100) { helper.textContent = (targetUnits - count) + ' to go. Pacing well.'; helper.classList.remove('good'); }
    else if (pctRaw < 130) { helper.textContent = '✓ Target hit — top up if you train this evening.'; helper.classList.add('good'); }
    else { helper.textContent = 'Strong — way past target.'; helper.classList.add('good'); }

    // Disable minus when at zero
    $('waterMinusBtn').disabled = count <= 0;

    renderWhy(calc, targetUnits);
    renderHistory();
    renderSparkline(targetUnits);
  }

  function renderWhy(calc, targetUnits) {
    const wrap = $('whyBody');
    if (calc.manual) {
      wrap.innerHTML =
        '<div class="why-row"><span class="why-label">Manual daily target</span><span class="why-val">' + fmtMl(calc.total) + '</span></div>'
        + '<div class="why-row total"><span class="why-label">Daily target</span><span class="why-val">' + fmtMl(calc.total) + ' ≈ ' + targetUnits + ' ' + unitLabelPlural() + '</span></div>';
      return;
    }
    const u = state.weightUnit;
    const wDisp = u === 'lb' ? (state.profile.weightKg).toFixed(0) : state.profile.weightKg.toFixed(0);
    let html = '';
    html += '<div class="why-row"><span class="why-label">Base (' + wDisp + ' ' + u + ' × 35 ml)</span><span class="why-val">' + fmtMl(calc.base) + '</span></div>';
    if (calc.exercise > 0)
      html += '<div class="why-row"><span class="why-label">+ Exercise (' + state.profile.activityHrsPerWeek + ' h/wk)</span><span class="why-val">+ ' + fmtMl(calc.exercise) + '</span></div>';
    if (calc.caffeine > 0)
      html += '<div class="why-row"><span class="why-label">+ Caffeine (' + state.caffeineMgPerDay + ' mg/day)</span><span class="why-val">+ ' + fmtMl(calc.caffeine) + '</span></div>';
    (state.substances || []).forEach(s => {
      html += '<div class="why-row"><span class="why-label">+ ' + escapeHtml(s.name) + ' (' + escapeHtml(subDoseLabel(s)) + ')</span><span class="why-val">+ ' + fmtMl(subExtraMl(s)) + '</span></div>';
    });
    if (calc.adjust > 0)
      html += '<div class="why-row"><span class="why-label">+ Sex / age adjustment</span><span class="why-val">+ ' + fmtMl(calc.adjust) + '</span></div>';
    html += '<div class="why-row total"><span class="why-label">Daily target</span><span class="why-val">' + fmtMl(calc.total) + ' ≈ ' + targetUnits + ' ' + unitLabelPlural() + '</span></div>';
    wrap.innerHTML = html;
  }

  function renderHistory() {
    const list = $('histList');
    const target = Math.ceil(computeTargetMl().total / unitVolMl());
    // Last 7 days
    const days = [];
    for (let i = 6; i >= 1; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const k = dateKey(d);
      const n = state.logs[k] || 0;
      days.push({ date: d, key: k, count: n });
    }
    list.innerHTML = days.map(({date, count}) => {
      const dows = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const lbl = dows[date.getDay()] + ' ' + (date.getMonth()+1) + '/' + date.getDate();
      const pct = Math.min(100, (count / target) * 100);
      const cls = (count >= target) ? '' : 'miss';
      return '<div class="hist-row">'
        + '<span class="hist-date">' + lbl + '</span>'
        + '<div class="hist-bar-wrap"><div class="hist-bar-fill ' + cls + '" style="width:' + pct + '%"></div></div>'
        + '<span class="hist-count">' + count + '/' + target + '</span>'
        + '</div>';
    }).join('') || '<div style="text-align:center;font-size:12px;color:var(--text-3);padding:12px 0">No logs yet.</div>';
  }

  function renderSparkline(target) {
    const svg = $('sparkSvg');
    const W = 280, H = 70, pad = 4;
    const days = 14;
    const data = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const k = dateKey(d);
      data.push(state.logs[k] || 0);
    }
    const maxVal = Math.max(target, Math.max.apply(null, data)) || 1;
    const colW = (W - pad * 2) / data.length;
    const barW = colW * 0.7;
    let html = '';
    // Target line
    const targetY = H - pad - (target / maxVal) * (H - pad * 2);
    html += '<line class="spark-target" x1="0" x2="' + W + '" y1="' + targetY.toFixed(1) + '" y2="' + targetY.toFixed(1) + '"/>';
    data.forEach((v, i) => {
      const x = pad + i * colW + (colW - barW) / 2;
      const h = (v / maxVal) * (H - pad * 2);
      const y = H - pad - h;
      const cls = (v >= target) ? 'spark-bar' : 'spark-bar miss';
      html += '<rect class="' + cls + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + Math.max(0, h).toFixed(1) + '" rx="2"/>';
    });
    svg.innerHTML = html;
  }

  function renderAll() { renderDayPill(); renderWater(); }

  // ============================================================
  // EVENT WIRING
  // ============================================================
  $('waterPlusBtn').addEventListener('click', () => {
    setTodayCount(todayCount() + 1);
    renderWater();
    const btn = $('waterPlusBtn');
    btn.style.transform = 'scale(0.97)';
    setTimeout(() => { btn.style.transform = ''; }, 120);
  });
  $('waterMinusBtn').addEventListener('click', () => {
    setTodayCount(Math.max(0, todayCount() - 1));
    renderWater();
  });

  $('whyToggle').addEventListener('click', () => {
    const body = $('whyBody');
    const open = body.classList.contains('show');
    body.classList.toggle('show');
    $('whyToggle').setAttribute('aria-expanded', open ? 'false' : 'true');
  });

  // ============================================================
  // SETTINGS
  // ============================================================
  function renderSettings() {
    $('setWeight').value = state.profile.weightKg;
    $('setAge').value = state.profile.age;
    $('setActivity').value = state.profile.activityHrsPerWeek;
    $('setCaffeine').value = state.caffeineMgPerDay;
    $('setBottleMl').value = state.bottleMl;
    $('setGlassMl').value = state.glassMl;
    $('setManualTargetMl').value = state.manualTargetMl;

    setSegActive('setUnit', state.unit);
    setSegActive('setWeightUnit', state.weightUnit);
    setSegActive('setSex', state.profile.sex);
    setSegActive('setTargetMode', state.useManualTarget ? 'manual' : 'auto');
    updateManualTargetVisibility();

    renderSubsList();
  }
  function updateManualTargetVisibility() {
    $('setManualTargetField').style.display = state.useManualTarget ? '' : 'none';
  }
  function setSegActive(segId, value) {
    $(segId).querySelectorAll('button').forEach(b => {
      const v = b.dataset.u || b.dataset.s || b.dataset.tm;
      b.classList.toggle('active', v === value);
    });
  }
  function bindSeg(segId, attr, onPick) {
    $(segId).querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        const v = b.dataset[attr];
        $(segId).querySelectorAll('button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        onPick(v);
      });
    });
  }
  bindSeg('setUnit', 'u', (v) => { state.unit = v; saveState(); renderWater(); });
  bindSeg('setWeightUnit', 'u', (v) => { state.weightUnit = v; saveState(); renderWater(); });
  bindSeg('setSex', 's', (v) => { state.profile.sex = v; saveState(); renderWater(); });
  bindSeg('setTargetMode', 'tm', (v) => {
    state.useManualTarget = (v === 'manual');
    saveState();
    updateManualTargetVisibility();
    renderWater();
  });

  ['setWeight','setAge','setActivity','setCaffeine','setBottleMl','setGlassMl','setManualTargetMl'].forEach(id => {
    $(id).addEventListener('input', () => {
      const v = parseFloat($(id).value);
      if (id === 'setWeight') state.profile.weightKg = v || 0;
      else if (id === 'setAge') state.profile.age = v || 0;
      else if (id === 'setActivity') state.profile.activityHrsPerWeek = v || 0;
      else if (id === 'setCaffeine') state.caffeineMgPerDay = v || 0;
      else if (id === 'setBottleMl') state.bottleMl = v || 500;
      else if (id === 'setGlassMl') state.glassMl = v || 250;
      else if (id === 'setManualTargetMl') state.manualTargetMl = v || 0;
      saveState(); renderWater();
    });
  });

  function renderSubsList() {
    const list = $('subsList');
    if (!state.substances || !state.substances.length) {
      list.innerHTML = '<div style="font-size:12px;color:var(--text-3);text-align:center;padding:14px 0;font-style:italic;">No substances added.</div>';
      return;
    }
    list.innerHTML = state.substances.map((s, i) =>
      '<div class="sub-row" data-i="' + i + '">'
      + '<div class="sub-row-info">'
      +   '<div class="sub-row-name">' + escapeHtml(s.name) + '</div>'
      +   '<div class="sub-row-meta">+ ' + fmtMl(subExtraMl(s)) + ' / day · ' + escapeHtml(s.cat || '') + '</div>'
      + '</div>'
      + '<div class="sub-row-dose">'
      +   '<input type="number" class="sub-dose-input" data-i="' + i + '" min="0" step="0.5" value="' + (s.dose != null ? s.dose : s.defaultDose) + '">'
      +   '<span class="sub-dose-unit">' + escapeHtml(s.unit || '') + '</span>'
      + '</div>'
      + '<button class="sub-row-del" data-i="' + i + '" aria-label="Remove">×</button>'
      + '</div>'
    ).join('');
    list.querySelectorAll('.sub-dose-input').forEach(inp => {
      inp.addEventListener('input', () => {
        const i = parseInt(inp.dataset.i, 10);
        state.substances[i].dose = parseFloat(inp.value) || 0;
        saveState();
        // Re-render the meta line for this row + the why card
        const row = inp.closest('.sub-row');
        const meta = row.querySelector('.sub-row-meta');
        meta.textContent = '+ ' + fmtMl(subExtraMl(state.substances[i])) + ' / day · ' + (state.substances[i].cat || '');
        renderWater();
      });
    });
    list.querySelectorAll('.sub-row-del').forEach(b => {
      b.addEventListener('click', () => {
        state.substances.splice(parseInt(b.dataset.i, 10), 1);
        saveState(); renderSubsList(); renderWater();
      });
    });
  }

  // Substance search
  $('subSearch').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    const results = $('subResults');
    if (!q) { results.classList.remove('show'); results.innerHTML = ''; return; }
    const matches = SUBSTANCE_DB.filter(s =>
      s.name.toLowerCase().includes(q) || s.cat.toLowerCase().includes(q)
    ).slice(0, 8);
    if (!matches.length) {
      results.innerHTML = '<div class="search-result"><span class="search-result-name">No matches</span><span class="search-result-meta">Try a different name or category</span></div>';
      results.classList.add('show');
      return;
    }
    results.innerHTML = matches.map(s => {
      const defaultExtra = (s.defaultDose || 0) * (s.mlPerUnit || 0);
      return '<div class="search-result" data-id="' + s.id + '">'
        + '<span class="search-result-name">' + escapeHtml(s.name) + ' <span class="search-result-add">+</span></span>'
        + '<span class="search-result-meta">' + escapeHtml(s.cat) + ' · ' + s.defaultDose + ' ' + escapeHtml(s.unit) + ' default → adds ~' + fmtMl(defaultExtra) + '/day · ' + escapeHtml(s.note) + '</span>'
        + '</div>';
    }).join('');
    results.classList.add('show');
    results.querySelectorAll('.search-result').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        const sub = SUBSTANCE_DB.find(x => x.id === id);
        if (!sub) return;
        if ((state.substances || []).find(x => x.id === id)) { alert('Already added — edit the dose below.'); return; }
        state.substances.push({
          id: sub.id, name: sub.name, cat: sub.cat,
          unit: sub.unit, mlPerUnit: sub.mlPerUnit,
          defaultDose: sub.defaultDose,
          dose: sub.defaultDose
        });
        saveState();
        $('subSearch').value = '';
        results.classList.remove('show');
        renderSubsList(); renderWater();
      });
    });
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrap')) $('subResults').classList.remove('show');
  });

  $('settingsBtn').addEventListener('click', () => {
    renderSettings();
    $('setModalBg').classList.add('show');
  });
  $('setClose').addEventListener('click', () => $('setModalBg').classList.remove('show'));

  // Export / import / reset
  $('setExport').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'water-coach-data-' + new Date().toISOString().slice(0,10) + '.json';
    a.click(); URL.revokeObjectURL(url);
  });
  $('setImport').addEventListener('click', () => $('setImportFile').click());
  $('setImportFile').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const parsed = JSON.parse(r.result);
        if (!confirm('Replace ALL current data with the imported file?')) return;
        state = normalize(parsed);
        saveState(); renderSettings(); renderAll();
      } catch (err) { alert('Import failed: ' + err.message); }
    };
    r.readAsText(f);
  });
  $('setReset').addEventListener('click', () => {
    if (!confirm('Wipe ALL water logs and settings? This cannot be undone.')) return;
    localStorage.removeItem(LS_KEY);
    state = loadState();
    $('setModalBg').classList.remove('show');
    renderAll();
  });

  // escapeHtml is now the shared global from escape.js — was named
  // `escape` locally here, renamed at every call site.

  // Cloud sync writes straight to localStorage and dispatches 'storage'
  // (see the initCloudSync call below) — pick that up so a change made
  // on another device actually shows up here without a manual reload.
  window.addEventListener('storage', () => {
    state = loadState();
    renderAll();
  });

  // BOOT
  renderAll();
})();
