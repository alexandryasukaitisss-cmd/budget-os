/* BudgetOS v2 — offline-first, import from notes, compact overview lists */

(() => {
  const LS_KEY = "budgetos_v2";

  const MONTHS = {
    "январь": "Январь",
    "февраль": "Февраль",
    "март": "Март",
    "апрель": "Апрель",
    "май": "Май",
    "июнь": "Июнь",
    "июль": "Июль",
    "август": "Август",
    "сентябрь": "Сентябрь",
    "октябрь": "Октябрь",
    "ноябрь": "Ноябрь",
    "декабрь": "Декабрь",
  };

  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];

  const fmt = (n) => {
    const v = Number.isFinite(n) ? n : 0;
    return v.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  };

  const todayISO = () => {
    const d = new Date();
    const m = String(d.getMonth()+1).padStart(2,"0");
    const day = String(d.getDate()).padStart(2,"0");
    return `${d.getFullYear()}-${m}-${day}`;
  };

  const uid = () => Math.random().toString(36).slice(2, 10);

  function loadState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return seedState();
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.months || !Array.isArray(parsed.months)) return seedState();
      return parsed;
    } catch {
      return seedState();
    }
  }

  function saveState(st) {
    localStorage.setItem(LS_KEY, JSON.stringify(st));
  }

  function seedState() {
    // Neutral demonstration month. No household or medical data.
    const monthId = "2025-12";
    // Synthetic starter data; saved user budgets are loaded before this fallback.
    const baseCats = [
      ["продукты", 100], ["транспорт", 40], ["жильё", 200],
      ["подписки", 20], ["накопления", 50],
    ].map(([name, plan]) => ({ id: uid(), name, plan, fact: 0, paid: false, note: "", entries: [] }));

    const st = {
      categoriesMaster: [...new Set(baseCats.map(c => c.name))],
      months: [{
        id: monthId,
        title: "Декабрь 2025",
        income: 0,
        categories: baseCats,
      }],
      selectedMonthId: monthId,
      ui: { planFactMode: "top8", hideTiny: true },
    };
    return st;
  }

  function getSelectedMonth(st) {
    return st.months.find(m => m.id === st.selectedMonthId) || st.months[0];
  }

  function ensureMasterCats(st) {
    const set = new Set(st.categoriesMaster || []);
    st.months.forEach(m => (m.categories || []).forEach(c => set.add(c.name)));
    st.categoriesMaster = [...set];
  }

  function ensureMonthHasAllCats(st, month) {
    const have = new Map((month.categories||[]).map(c => [c.name, c]));
    st.categoriesMaster.forEach(name => {
      if (!have.has(name)) {
        month.categories.push({ id: uid(), name, plan: 0, fact: 0, paid: false, note: "", entries: [] });
      }
    });
    // Stable ordering: by master order
    const order = new Map(st.categoriesMaster.map((n,i)=>[n,i]));
    month.categories.sort((a,b) => (order.get(a.name) ?? 9999) - (order.get(b.name) ?? 9999));
  }

  // ----- Parsing (import) -----

  function normalizeText(s) {
    return (s || "")
      .replace(/\u00A0/g, " ")
      .replace(/[–—]/g, "-")
      .replace(/[“”«»]/g, '"')
      .trim();
  }

  function parseMoneyToken(s) {
    // supports "1 400", "1400", "5 670", "776,51"
    const m = s.match(/^\s*([0-9][0-9\s]*([\.,][0-9]{1,2})?)/);
    if (!m) return null;
    const raw = m[1].replace(/\s+/g, "").replace(",", ".");
    const val = Number(raw);
    if (!Number.isFinite(val)) return null;
    return { value: val, len: m[0].length };
  }

  function hasDa(str) {
    // кириллица, без \b (у JS с кириллицей ненадёжно). Ищем "да" как отдельный токен.
    const s = String(str || "").toLowerCase();
    return /(?:^|\s|\(|\[|\{|,|;|:|\.)да(?:$|\s|\)|\]|\}|,|;|!|\?|\.|:)/.test(s);
  }

  function normalizeCategoryName(name) {
    let n = (name || "").trim();
    // убрать хвостовые запятые/точки
    n = n.replace(/[\s,.;:]+$/g, "");
    // нормализация некоторых вариантов
    const low = n.toLowerCase();
    if (low === "гаи" || low.includes("штраф") && low.includes("гаи")) return "штраф ГАИ";
    if (low.includes("wb") || low.includes("вб") || low.includes("ozon") || low.includes("озон")) return "вб/озон";
    return n;
  }

  function splitNote(catText) {
    const s = catText;
    const low = s.toLowerCase();
    const idx = low.indexOf("из них");
    if (idx >= 0) {
      const left = s.slice(0, idx).replace(/[\s,]+$/g, "");
      const note = s.slice(idx).trim();
      return { cat: left || s, note };
    }
    return { cat: s, note: "" };
  }

  function parseNotes(text) {
    const lines = normalizeText(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    // month detection (e.g. "Траты (декабрь)")
    let monthWord = null;
    for (const ln of lines) {
      const m = ln.match(/^\s*Траты\s*\(([^)]+)\)/i);
      if (m) { monthWord = m[1].trim().toLowerCase(); break; }
    }
    // year detection (optional): try find "2025" somewhere
    let year = null;
    for (const ln of lines) {
      const ym = ln.match(/\b(20\d{2})\b/);
      if (ym) { year = Number(ym[1]); break; }
    }
    if (!year) year = new Date().getFullYear(); // reasonable default

    let monthTitle = null;
    let monthId = null;
    if (monthWord) {
      const key = Object.keys(MONTHS).find(k => monthWord.includes(k));
      if (key) {
        monthTitle = `${MONTHS[key]} ${year}`;
        const monthNum = String(Object.keys(MONTHS).indexOf(key) + 1).padStart(2, "0");
        monthId = `${year}-${monthNum}`;
      }
    }

    // income
    let income = 0;
    for (const ln of lines) {
      const m = ln.match(/Доходы\s*:\s*([0-9\s]+([\.,][0-9]{1,2})?)/i);
      if (m) {
        income = Number(m[1].replace(/\s+/g,"").replace(",", ".")) || 0;
        break;
      }
    }

    const cats = [];
    const ignored = [];

    for (const rawLine of lines) {
      const line = normalizeText(rawLine);

      if (/^[-_]{3,}$/.test(line)) continue;
      if (/^Траты\s*:/i.test(line)) { ignored.push(line); continue; } // "Траты: (12.12) 2255 из 5500"
      if (/^Доходы\s*:/i.test(line)) { ignored.push(line); continue; }
      if (/^Карта\b/i.test(line)) { ignored.push(line); continue; }
      if (/^На\s+/i.test(line)) { ignored.push(line); continue; }

      // category lines must start with a number (plan)
      const money = parseMoneyToken(line);
      if (!money) { ignored.push(line); continue; }
      const plan = money.value;
      let rest = line.slice(money.len).trim();

      let paid = false;
      let fact = null;

      // collect parentheses blocks anywhere
      const parens = [...rest.matchAll(/\(([^)]*)\)/g)].map(m => m[1]);
      if (parens.length) {
        for (const p of parens) {
          if (hasDa(p)) paid = true;
          const pm = parseMoneyToken(p);
          if (pm) fact = pm.value;
        }
        rest = rest.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
      }

      // also sometimes "еда (1330), из них..." => parens already handled above; good.

      // If "(да)" without number => treat as paid and set fact = plan
      if (paid && (fact === null || fact === undefined)) fact = plan;

      // If still no fact, but line contains trailing "(1490 да)" handled, otherwise fact=0 (unknown)
      if (fact === null || fact === undefined) fact = 0;

      // remaining string is category + note
      let catText = rest;
      catText = catText.replace(/^[-–—:,]+\s*/g, "").trim();
      if (!catText) { ignored.push(line); continue; }

      const { cat, note } = splitNote(catText);
      const name = normalizeCategoryName(cat);

      cats.push({
        name,
        plan,
        fact,
        paid: paid || (fact >= plan && plan > 0),
        note: note || "",
      });
    }

    return { monthId, monthTitle, income, cats, ignored };
  }

  function mergeCats(masterNames, existingCats, importedCats) {
    const map = new Map(existingCats.map(c => [c.name, c]));
    for (const ic of importedCats) {
      const name = normalizeCategoryName(ic.name);
      masterNames.add(name);
      if (!map.has(name)) {
        map.set(name, { id: uid(), name, plan: ic.plan || 0, fact: ic.fact || 0, paid: !!ic.paid, note: ic.note || "", entries: [] });
      } else {
        const c = map.get(name);
        c.plan = ic.plan ?? c.plan;
        c.fact = ic.fact ?? c.fact;
        c.paid = !!ic.paid || c.paid;
        if (ic.note) c.note = ic.note;
      }
    }
    return [...map.values()];
  }

  // ----- UI rendering -----

  function setTab(tabId) {
    $$(".tab").forEach(b => {
      const active = b.dataset.tab === tabId;
      b.classList.toggle("active", active);
      b.setAttribute("aria-selected", active ? "true" : "false");
    });
    $$(".tab-content").forEach(sec => sec.classList.toggle("active", sec.id === tabId));
  }

  function totals(month) {
    const plan = (month.categories || []).reduce((s,c)=>s+(Number(c.plan)||0),0);
    const factManual = (month.categories || []).reduce((s,c)=>s+(Number(c.fact)||0),0);
    const entriesSum = (month.categories || []).reduce((s,c)=>s + (c.entries||[]).reduce((ss,e)=>ss+(Number(e.amount)||0),0),0);
    const fact = factManual + entriesSum;
    const remain = plan - fact;
    return { plan, fact, remain };
  }

  function categoryComputedFact(cat) {
    const base = Number(cat.fact)||0;
    const entries = (cat.entries||[]).reduce((s,e)=>s+(Number(e.amount)||0),0);
    return base + entries;
  }

  function renderMonthSelect(st) {
    const sel = $("#monthSelect");
    sel.innerHTML = "";
    st.months
      .slice()
      .sort((a,b)=>a.id.localeCompare(b.id))
      .forEach(m => {
        const opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = m.title;
        if (m.id === st.selectedMonthId) opt.selected = true;
        sel.appendChild(opt);
      });
    sel.onchange = () => {
      st.selectedMonthId = sel.value;
      saveState(st);
      renderAll(st);
    };
  }

  function renderKPIs(month) {
    const t = totals(month);
    $("#kpiPlan").textContent = fmt(t.plan);
    $("#kpiFact").textContent = fmt(t.fact);
    $("#kpiRemain").textContent = fmt(t.remain);
  }

  function renderCategories(st, month) {
    const body = $("#categoriesTable");
    body.innerHTML = "";

    // Keep month categories consistent with master
    ensureMasterCats(st);
    ensureMonthHasAllCats(st, month);

    const masterOrder = new Map(st.categoriesMaster.map((n,i)=>[n,i]));
    month.categories.sort((a,b)=>(masterOrder.get(a.name)??9999)-(masterOrder.get(b.name)??9999));

    for (const cat of month.categories) {
      const fact = categoryComputedFact(cat);
      const remain = (Number(cat.plan)||0) - fact;

      const row = document.createElement("div");
      row.className = "trow";

      const pillClass = remain === 0 ? "pill zero" : (remain < 0 ? "pill neg" : "pill");

      row.innerHTML = `
        <div class="item-name" title="${escapeHtml(cat.name)}">${escapeHtml(cat.name)}</div>
        <input class="input small num" type="number" inputmode="decimal" value="${Number(cat.plan)||0}">
        <input class="input small num" type="number" inputmode="decimal" value="${Number(cat.fact)||0}">
        <div class="${pillClass}">${fmt(remain)} BYN</div>
        <div class="center"><input type="checkbox" ${cat.paid ? "checked" : ""} aria-label="Оплачено"></div>
        <div class="center"><button class="ellipsis" aria-label="Действия">⋯</button></div>
      `;

      const [planInp, factInp] = $$("input.input.small", row);

      planInp.addEventListener("input", () => {
        cat.plan = Number(planInp.value)||0;
        cat.paid = cat.paid || false;
        saveState(st);
        renderAll(st);
      });

      factInp.addEventListener("input", () => {
        cat.fact = Number(factInp.value)||0;
        saveState(st);
        renderAll(st);
      });

      const paidChk = $("input[type=checkbox]", row);
      paidChk.addEventListener("change", () => {
        cat.paid = paidChk.checked;
        if (paidChk.checked) {
          // requirement: paid => fact becomes plan, remain 0 (ignoring entries -> we set base fact so that base+entries == plan)
          const entriesSum = (cat.entries||[]).reduce((s,e)=>s+(Number(e.amount)||0),0);
          cat.fact = Math.max(0, (Number(cat.plan)||0) - entriesSum);
        }
        saveState(st);
        renderAll(st);
      });

      const menuBtn = $(".ellipsis", row);
      menuBtn.addEventListener("click", () => {
        const ok = confirm(`Удалить категорию "${cat.name}" из ЭТОГО месяца? (из справочника она не удалится)`);
        if (!ok) return;
        month.categories = month.categories.filter(c => c.id !== cat.id);
        saveState(st);
        renderAll(st);
      });

      body.appendChild(row);
    }

    renderKPIs(month);
  }

  function renderOverview(st, month) {
    const hideTiny = $("#hideTiny").checked;
    const mode = st.ui?.planFactMode || "top8";

    const cats = month.categories || [];
    const rows = cats.map(c => {
      const fact = categoryComputedFact(c);
      return { c, fact, plan: Number(c.plan)||0 };
    }).filter(r => r.fact > 0 || r.plan > 0);

    const totalFact = rows.reduce((s,r)=>s+r.fact,0) || 0;

    // Structure list
    const structure = $("#expenseStructure");
    structure.innerHTML = "";
    rows
      .filter(r => r.fact > 0)
      .sort((a,b)=>b.fact-a.fact)
      .forEach(r => {
        const pct = totalFact ? (r.fact / totalFact * 100) : 0;
        if (hideTiny && pct < 1) return;

        const el = document.createElement("div");
        el.className = "item";

        el.innerHTML = `
          <div class="item-top">
            <div class="item-name" title="${escapeHtml(r.c.name)}">${escapeHtml(r.c.name)}</div>
            <div class="item-right">
              <div class="item-amt">${fmt(r.fact)} BYN</div>
              <div class="item-meta">${pct.toFixed(1)}%</div>
            </div>
          </div>
          <div class="bar"><div style="width:${Math.min(100, pct).toFixed(1)}%"></div></div>
        `;
        structure.appendChild(el);
      });

    if (!structure.children.length) {
      const empty = document.createElement("div");
      empty.className = "item";
      empty.textContent = "Пока нет фактических расходов. Добавьте факт в категориях или записи.";
      structure.appendChild(empty);
    }

    // Plan vs fact list
    const planFact = $("#planFact");
    planFact.innerHTML = "";

    let pfRows = rows
      .filter(r => r.plan > 0 || r.fact > 0)
      .sort((a,b)=>(b.fact/b.plan||0) - (a.fact/a.plan||0));

    if (mode === "top8") {
      // Prefer by fact amount
      pfRows = rows
        .filter(r => r.plan > 0 || r.fact > 0)
        .sort((a,b)=>b.fact-a.fact)
        .slice(0, 8);
    }

    pfRows.forEach(r => {
      const ratio = (r.plan > 0) ? (r.fact / r.plan * 100) : (r.fact > 0 ? 100 : 0);
      const pct = Math.min(300, Math.max(0, ratio)); // allow overspend visual up to 300%
      const el = document.createElement("div");
      el.className = "item";
      el.innerHTML = `
        <div class="item-top">
          <div class="item-name" title="${escapeHtml(r.c.name)}">${escapeHtml(r.c.name)}</div>
          <div class="item-right">
            <div class="item-amt">${fmt(r.fact)} / ${fmt(r.plan)} BYN</div>
            <div class="item-meta">${(ratio||0).toFixed(0)}%</div>
          </div>
        </div>
        <div class="bar"><div style="width:${Math.min(100, pct).toFixed(1)}%"></div></div>
      `;
      planFact.appendChild(el);
    });

    if (!planFact.children.length) {
      const empty = document.createElement("div");
      empty.className = "item";
      empty.textContent = "Нет данных для сравнения плана и факта.";
      planFact.appendChild(empty);
    }
  }

  function renderRecords(st, month) {
    const list = $("#recordsList");
    list.innerHTML = "";

    const all = [];
    for (const cat of month.categories || []) {
      for (const e of (cat.entries || [])) {
        all.push({ ...e, catName: cat.name, catId: cat.id });
      }
    }
    all.sort((a,b)=>(b.date||"").localeCompare(a.date||""));

    if (!all.length) {
      const empty = document.createElement("div");
      empty.className = "item";
      empty.textContent = "Записей пока нет. Можно жить только “Категориями”, а записи использовать для детализации.";
      list.appendChild(empty);
      return;
    }

    for (const e of all) {
      const el = document.createElement("div");
      el.className = "record";
      el.innerHTML = `
        <div class="l">
          <div class="t">${escapeHtml(e.catName)} • ${escapeHtml(e.note || "")}</div>
          <div class="s">${escapeHtml(e.date || "")}</div>
        </div>
        <div class="r">
          <div class="a">${fmt(Number(e.amount)||0)} BYN</div>
          <div class="d"><button class="btn" data-del="${escapeHtml(e.id)}">Удалить</button></div>
        </div>
      `;
      $("button[data-del]", el).addEventListener("click", () => {
        const ok = confirm("Удалить эту запись?");
        if (!ok) return;
        for (const cat of month.categories || []) {
          cat.entries = (cat.entries || []).filter(x => x.id !== e.id);
        }
        saveState(st);
        renderAll(st);
      });
      list.appendChild(el);
    }
  }

  function renderAll(st) {
    const month = getSelectedMonth(st);
    renderMonthSelect(st);

    // bind overview switches from state
    $("#hideTiny").checked = !!st.ui?.hideTiny;

    renderCategories(st, month);
    renderOverview(st, month);
    renderRecords(st, month);
    renderRecordCategorySelect(st, month);
  }

  function renderRecordCategorySelect(st, month) {
    const sel = $("#recordCategory");
    sel.innerHTML = "";
    const cats = (month.categories||[]).slice().sort((a,b)=>a.name.localeCompare(b.name, "ru"));
    for (const c of cats) {
      const o = document.createElement("option");
      o.value = c.id;
      o.textContent = c.name;
      sel.appendChild(o);
    }
  }

  // ----- Modals -----
  function showModal(id) { $("#"+id).classList.remove("hidden"); }
  function hideModal(id) { $("#"+id).classList.add("hidden"); }

  function bindModalClosers() {
    $$("[data-close]").forEach(btn => {
      btn.addEventListener("click", () => hideModal(btn.dataset.close));
    });
    $$(".modal").forEach(m => {
      m.addEventListener("click", (e) => {
        if (e.target === m) m.classList.add("hidden");
      });
    });
  }

  // ----- Actions -----

  function wireUI(st) {
    $$(".tab").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));

    $("#hideTiny").addEventListener("change", () => {
      st.ui = st.ui || {};
      st.ui.hideTiny = $("#hideTiny").checked;
      saveState(st);
      renderAll(st);
    });

    $("#pfTop8").addEventListener("click", () => {
      st.ui = st.ui || {};
      st.ui.planFactMode = "top8";
      $("#pfTop8").classList.add("active");
      $("#pfAll").classList.remove("active");
      saveState(st);
      renderAll(st);
    });
    $("#pfAll").addEventListener("click", () => {
      st.ui = st.ui || {};
      st.ui.planFactMode = "all";
      $("#pfAll").classList.add("active");
      $("#pfTop8").classList.remove("active");
      saveState(st);
      renderAll(st);
    });

    $("#importBtn").addEventListener("click", () => {
      $("#importText").value = "";
      $("#importMerge").checked = false;
      showModal("modalImport");
    });

    $("#importDo").addEventListener("click", () => {
      const text = $("#importText").value.trim();
      if (!text) return alert("Вставьте текст для импорта.");
      const parsed = parseNotes(text);

      const month = getSelectedMonth(st);

      // Determine target month (new or merge)
      const merge = $("#importMerge").checked;

      const targetId = merge ? month.id : (parsed.monthId || month.id);
      const targetTitle = merge ? month.title : (parsed.monthTitle || month.title);

      let target = st.months.find(m => m.id === targetId);
      if (!target) {
        target = { id: targetId, title: targetTitle, income: 0, categories: [] };
        st.months.push(target);
      } else if (!merge && target.id !== month.id) {
        // If importing to existing other month, ask overwrite
        const ok = confirm(`Месяц "${target.title}" уже существует. Перезаписать категории из импорта (план/факт/оплачено)?`);
        if (!ok) return;
      }

      const masterSet = new Set(st.categoriesMaster || []);
      if (merge) {
        target.categories = mergeCats(masterSet, target.categories || [], parsed.cats);
      } else {
        // replace month categories with imported cats (but still expand to master later)
        target.categories = parsed.cats.map(ic => ({
          id: uid(),
          name: normalizeCategoryName(ic.name),
          plan: ic.plan || 0,
          fact: ic.fact || 0,
          paid: !!ic.paid,
          note: ic.note || "",
          entries: [],
        }));
        // merge in previous master categories later
        parsed.cats.forEach(ic => masterSet.add(normalizeCategoryName(ic.name)));
      }

      st.categoriesMaster = [...masterSet];

      if (parsed.income) target.income = parsed.income;

      ensureMasterCats(st);
      ensureMonthHasAllCats(st, target);

      st.selectedMonthId = target.id;

      saveState(st);
      hideModal("modalImport");
      renderAll(st);

      // Brief import summary
      if (parsed.ignored.length) {
        console.log("BudgetOS import ignored lines:", parsed.ignored);
      }
    });

    $("#exportBtn").addEventListener("click", async () => {
      try {
        const data = JSON.stringify(st, null, 2);
        await navigator.clipboard.writeText(data);
        alert("Экспорт: JSON скопирован в буфер обмена.");
      } catch {
        alert("Не удалось скопировать. Откройте консоль и возьмите JSON из localStorage key budgetos_v2.");
      }
    });

    // Record modal openers
    const openRecord = () => {
      $("#recordAmount").value = "";
      $("#recordNote").value = "";
      $("#recordDate").value = todayISO();
      showModal("modalRecord");
    };
    $("#addRecordBtn").addEventListener("click", openRecord);
    $("#addRecordBtn2").addEventListener("click", openRecord);

    $("#recordSave").addEventListener("click", () => {
      const month = getSelectedMonth(st);
      const catId = $("#recordCategory").value;
      const amount = Number($("#recordAmount").value || 0);
      const date = $("#recordDate").value || todayISO();
      const note = $("#recordNote").value.trim();

      if (!catId) return alert("Выберите категорию.");
      if (!amount || amount <= 0) return alert("Введите сумму > 0.");

      const cat = (month.categories || []).find(c => c.id === catId);
      if (!cat) return alert("Категория не найдена.");

      cat.entries = cat.entries || [];
      cat.entries.push({ id: uid(), amount, date, note });

      saveState(st);
      hideModal("modalRecord");
      renderAll(st);
    });

    // Add category
    $("#addCategoryBtn").addEventListener("click", () => {
      $("#newCatName").value = "";
      $("#newCatPlan").value = "";
      showModal("modalCategory");
    });

    $("#catSave").addEventListener("click", () => {
      const name = normalizeCategoryName($("#newCatName").value.trim());
      const plan = Number($("#newCatPlan").value || 0);
      if (!name) return alert("Введите название категории.");

      const month = getSelectedMonth(st);

      // Update master
      ensureMasterCats(st);
      if (!st.categoriesMaster.includes(name)) st.categoriesMaster.push(name);

      // Add to current month if missing
      if (!(month.categories||[]).some(c => c.name === name)) {
        (month.categories = month.categories || []).push({ id: uid(), name, plan, fact: 0, paid: false, note: "", entries: [] });
      } else {
        const c = month.categories.find(x=>x.name===name);
        c.plan = plan || c.plan;
      }

      ensureMasterCats(st);
      ensureMonthHasAllCats(st, month);

      saveState(st);
      hideModal("modalCategory");
      renderAll(st);
    });

    $("#settingsBtn").addEventListener("click", () => {
      alert("Настройки (v2): пока только скрытие <1% и режим Plan vs Fact (Топ‑8/Все).");
    });
  }

  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // Service worker
  async function maybeRegisterSW() {
    if (!("serviceWorker" in navigator)) return;
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch (e) {
      console.warn("SW register failed", e);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const st = loadState();
    ensureMasterCats(st);
    saveState(st);

    bindModalClosers();
    wireUI(st);

    // apply UI state
    const mode = st.ui?.planFactMode || "top8";
    $("#pfTop8").classList.toggle("active", mode === "top8");
    $("#pfAll").classList.toggle("active", mode === "all");

    renderAll(st);
    maybeRegisterSW();
  });
})();
