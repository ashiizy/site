/* global Quill */

(() => {
  const STORAGE_KEY = "internalInstructions.v1";
  const SCHEMA_VERSION = 1;
  const CFG = /** @type {any} */ (window.__APP_CONFIG__ || {});
  const REMOTE = {
    url: typeof CFG.SUPABASE_URL === "string" ? CFG.SUPABASE_URL.trim() : "",
    anonKey: typeof CFG.SUPABASE_ANON_KEY === "string" ? CFG.SUPABASE_ANON_KEY.trim() : "",
    fnName: typeof CFG.SUPABASE_FUNCTION_NAME === "string" ? CFG.SUPABASE_FUNCTION_NAME.trim() : "instructions",
  };
  const HAS_REMOTE = Boolean(REMOTE.url && REMOTE.anonKey && REMOTE.fnName);
  const EDIT_PASSWORD_KEY = "internalInstructions.editPassword.v1";

  /** @typedef {{id:string,title:string,region:string,program:string,dueDate:string,isExpiredOverride:boolean,contentHtml:string,updatedAt:string,createdAt:string}} Instruction */

  const els = {
    filterRegion: document.getElementById("filterRegion"),
    filterProgram: document.getElementById("filterProgram"),
    filterQuery: document.getElementById("filterQuery"),

    btnAdd: document.getElementById("btnAdd"),
    btnExport: document.getElementById("btnExport"),
    btnImport: document.getElementById("btnImport"),
    fileImport: document.getElementById("fileImport"),

    cards: document.getElementById("cards"),
    empty: document.getElementById("empty"),
    stats: document.getElementById("stats"),

    viewModal: document.getElementById("viewModal"),
    viewTitle: document.getElementById("viewTitle"),
    viewMeta: document.getElementById("viewMeta"),
    viewContent: document.getElementById("viewContent"),
    btnCopyFromView: document.getElementById("btnCopyFromView"),
    btnEditFromView: document.getElementById("btnEditFromView"),
    btnDeleteFromView: document.getElementById("btnDeleteFromView"),

    editModal: document.getElementById("editModal"),
    editForm: document.getElementById("editForm"),
    editTitle: document.getElementById("editTitle"),
    inpTitle: document.getElementById("inpTitle"),
    inpRegion: document.getElementById("inpRegion"),
    inpProgram: document.getElementById("inpProgram"),
    inpDueDate: document.getElementById("inpDueDate"),
    inpExpiredOverride: document.getElementById("inpExpiredOverride"),
    editError: document.getElementById("editError"),

    toast: document.getElementById("toast"),
  };

  /** @type {{version:number, instructions: Instruction[]}} */
  let db = { version: SCHEMA_VERSION, instructions: [] };

  /** @type {Instruction | null} */
  let selected = null;

  /** @type {Instruction | null} */
  let editing = null;

  let quill = null;
  let toastTimer = null;
  let lastActiveEl = null;

  function nowIso() {
    return new Date().toISOString();
  }

  function todayYmd() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function compareYmd(a, b) {
    // ISO YYYY-MM-DD lexicographically comparable
    if (a === b) return 0;
    return a < b ? -1 : 1;
  }

  function safeId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `id_${Math.random().toString(16).slice(2)}_${Date.now()}`;
  }

  function loadDb() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: SCHEMA_VERSION, instructions: [] };
    try {
      const parsed = JSON.parse(raw);
      return migrateDb(parsed);
    } catch {
      return { version: SCHEMA_VERSION, instructions: [] };
    }
  }

  function saveDb() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  }

  function getEditPassword() {
    return sessionStorage.getItem(EDIT_PASSWORD_KEY) || "";
  }

  function setEditPassword(pw) {
    sessionStorage.setItem(EDIT_PASSWORD_KEY, pw);
  }

  async function ensureEditPassword() {
    const existing = getEditPassword();
    if (existing) return existing;
    const pw = window.prompt("Введите общий пароль для редактирования/удаления.");
    if (!pw) return "";
    setEditPassword(pw);
    return pw;
  }

  function supabaseFunctionUrl() {
    // https://<project>.supabase.co/functions/v1/<fn>
    return `${REMOTE.url.replace(/\\/+$/, "")}/functions/v1/${encodeURIComponent(REMOTE.fnName)}`;
  }

  async function remoteList() {
    const res = await fetch(supabaseFunctionUrl(), {
      method: "GET",
      headers: {
        apikey: REMOTE.anonKey,
        Authorization: `Bearer ${REMOTE.anonKey}`,
      },
    });
    if (!res.ok) throw new Error(`Ошибка загрузки (${res.status}).`);
    const data = await res.json();
    const migrated = migrateDb(data);
    return migrated.instructions;
  }

  async function remoteUpsert(instruction) {
    const pw = await ensureEditPassword();
    if (!pw) throw new Error("Нужен пароль.");
    const res = await fetch(supabaseFunctionUrl(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: REMOTE.anonKey,
        Authorization: `Bearer ${REMOTE.anonKey}`,
        "x-edit-password": pw,
      },
      body: JSON.stringify({ instruction }),
    });
    if (res.status === 401) throw new Error("Неверный пароль.");
    if (!res.ok) throw new Error(`Ошибка сохранения (${res.status}).`);
    const data = await res.json();
    return normalizeInstruction(data?.instruction);
  }

  async function remoteDelete(id) {
    const pw = await ensureEditPassword();
    if (!pw) throw new Error("Нужен пароль.");
    const res = await fetch(supabaseFunctionUrl(), {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        apikey: REMOTE.anonKey,
        Authorization: `Bearer ${REMOTE.anonKey}`,
        "x-edit-password": pw,
      },
      body: JSON.stringify({ id }),
    });
    if (res.status === 401) throw new Error("Неверный пароль.");
    if (!res.ok) throw new Error(`Ошибка удаления (${res.status}).`);
  }

  function migrateDb(maybe) {
    const base = {
      version: typeof maybe?.version === "number" ? maybe.version : 0,
      instructions: Array.isArray(maybe?.instructions) ? maybe.instructions : [],
    };

    // v0 -> v1 normalization
    const instructions = base.instructions
      .map((x) => normalizeInstruction(x))
      .filter((x) => x && x.id && x.title);

    return { version: SCHEMA_VERSION, instructions };
  }

  function normalizeInstruction(x) {
    if (!x || typeof x !== "object") return null;
    const title = String(x.title ?? "").trim();
    const region = String(x.region ?? "").trim();
    const program = String(x.program ?? "").trim();
    const dueDate = String(x.dueDate ?? "").slice(0, 10);
    const isExpiredOverride = Boolean(x.isExpiredOverride);
    const contentHtml = typeof x.contentHtml === "string" ? sanitizeRichHtml(x.contentHtml) : "";
    const createdAt = typeof x.createdAt === "string" ? x.createdAt : nowIso();
    const updatedAt = typeof x.updatedAt === "string" ? x.updatedAt : nowIso();
    const id = typeof x.id === "string" && x.id ? x.id : safeId();

    return {
      id,
      title,
      region,
      program,
      dueDate,
      isExpiredOverride,
      contentHtml,
      createdAt,
      updatedAt,
    };
  }

  function computeStatus(i) {
    const today = todayYmd();
    const isExpiredByDate = i.dueDate ? compareYmd(i.dueDate, today) < 0 : false;
    const isExpired = Boolean(i.isExpiredOverride || isExpiredByDate);
    const isNear = !isExpired && i.dueDate ? compareYmd(i.dueDate, today) >= 0 && daysUntil(i.dueDate) <= 14 : false;
    return { isExpired, isNear, isExpiredByDate };
  }

  function daysUntil(ymd) {
    if (!ymd) return Infinity;
    const [y, m, d] = ymd.split("-").map((s) => Number(s));
    if (!y || !m || !d) return Infinity;
    const target = new Date(y, m - 1, d, 23, 59, 59, 999);
    const diffMs = target.getTime() - Date.now();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  }

  function formatDue(ymd) {
    if (!ymd) return "—";
    // Keep ISO for sorting; display as DD.MM.YYYY
    const [y, m, d] = ymd.split("-");
    if (!y || !m || !d) return ymd;
    return `${d}.${m}.${y}`;
  }

  function escapeText(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function sanitizeRichHtml(html) {
    if (!html) return "";
    if (typeof html !== "string") return "";

    const allowedTags = new Set([
      "P",
      "BR",
      "DIV",
      "SPAN",
      "STRONG",
      "B",
      "EM",
      "I",
      "U",
      "S",
      "A",
      "OL",
      "UL",
      "LI",
      "H1",
      "H2",
      "H3",
      "BLOCKQUOTE",
      "PRE",
      "CODE",
    ]);

    const allowedAttrs = {
      A: new Set(["href", "target", "rel"]),
      SPAN: new Set(["class"]),
      DIV: new Set(["class"]),
      P: new Set(["class"]),
      OL: new Set(["class"]),
      UL: new Set(["class"]),
      LI: new Set(["class"]),
      PRE: new Set(["class"]),
      CODE: new Set(["class"]),
      H1: new Set(["class"]),
      H2: new Set(["class"]),
      H3: new Set(["class"]),
      BLOCKQUOTE: new Set(["class"]),
      STRONG: new Set([]),
      B: new Set([]),
      EM: new Set([]),
      I: new Set([]),
      U: new Set([]),
      S: new Set([]),
      BR: new Set([]),
    };

    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
    const root = doc.body?.firstElementChild;
    if (!root) return "";

    const nodes = Array.from(root.querySelectorAll("*"));
    for (const el of nodes) {
      const tag = el.tagName;
      if (!allowedTags.has(tag)) {
        el.replaceWith(doc.createTextNode(el.textContent || ""));
        continue;
      }

      for (const attr of Array.from(el.attributes)) {
        const allowed = allowedAttrs[tag] || new Set();
        if (!allowed.has(attr.name)) {
          el.removeAttribute(attr.name);
        }
      }

      if (tag === "A") {
        const href = el.getAttribute("href") || "";
        const isSafe =
          href.startsWith("http://") ||
          href.startsWith("https://") ||
          href.startsWith("mailto:") ||
          href.startsWith("#");
        if (!isSafe) el.removeAttribute("href");
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }
    }

    return root.innerHTML;
  }

  function setToast(text) {
    window.clearTimeout(toastTimer);
    els.toast.textContent = text;
    els.toast.classList.add("isOpen");
    toastTimer = window.setTimeout(() => {
      els.toast.classList.remove("isOpen");
    }, 2200);
  }

  function openModal(kind) {
    lastActiveEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modal = kind === "view" ? els.viewModal : els.editModal;
    modal.classList.add("isOpen");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";

    window.setTimeout(() => {
      const focusTarget =
        kind === "view"
          ? els.btnEditFromView
          : els.inpTitle;
      focusTarget?.focus?.();
    }, 0);
  }

  function closeModal(kind) {
    const modal = kind === "view" ? els.viewModal : els.editModal;
    modal.classList.remove("isOpen");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";

    if (lastActiveEl && document.contains(lastActiveEl)) {
      lastActiveEl.focus();
    }
    lastActiveEl = null;
  }

  function initQuill() {
    quill = new Quill("#quillEditor", {
      theme: "snow",
      modules: {
        toolbar: [
          [{ header: [1, 2, 3, false] }],
          ["bold", "italic", "underline", "strike"],
          [{ list: "ordered" }, { list: "bullet" }],
          [{ indent: "-1" }, { indent: "+1" }],
          ["blockquote", "code-block"],
          ["link", "image"],
          ["clean"],
        ],
      },
    });

    // Custom image handler: embed as data URL (works offline + in LocalStorage).
    const toolbar = quill.getModule("toolbar");
    toolbar.addHandler("image", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.click();
      input.addEventListener(
        "change",
        async () => {
          const file = input.files?.[0];
          if (!file) return;
          if (!file.type.startsWith("image/")) {
            setToast("Выберите изображение.");
            return;
          }
          if (file.size > 3 * 1024 * 1024) {
            setToast("Картинка слишком большая (лимит 3 МБ).");
            return;
          }
          const dataUrl = await fileToDataUrl(file);
          const range = quill.getSelection(true) || { index: quill.getLength(), length: 0 };
          quill.insertEmbed(range.index, "image", dataUrl, "user");
          quill.setSelection(range.index + 1, 0, "silent");
        },
        { once: true },
      );
    });
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Не удалось прочитать файл."));
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(file);
    });
  }

  function setSelectOptions(selectEl, values, placeholderAll = "Все") {
    const current = selectEl.value;
    selectEl.innerHTML = "";

    const optAll = document.createElement("option");
    optAll.value = "";
    optAll.textContent = placeholderAll;
    selectEl.appendChild(optAll);

    for (const v of values) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      selectEl.appendChild(opt);
    }

    // Try preserve selection
    if ([...selectEl.options].some((o) => o.value === current)) {
      selectEl.value = current;
    } else {
      selectEl.value = "";
    }
  }

  function getFilterState() {
    return {
      region: els.filterRegion.value.trim(),
      program: els.filterProgram.value.trim(),
      query: els.filterQuery.value.trim().toLowerCase(),
    };
  }

  function applyFilters(instructions) {
    const f = getFilterState();
    return instructions.filter((i) => {
      if (f.region && i.region !== f.region) return false;
      if (f.program && i.program !== f.program) return false;
      if (f.query && !i.title.toLowerCase().includes(f.query)) return false;
      return true;
    });
  }

  function refreshFiltersFromData() {
    const regions = Array.from(new Set(db.instructions.map((i) => i.region).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ru"));
    const programs = Array.from(new Set(db.instructions.map((i) => i.program).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ru"));
    setSelectOptions(els.filterRegion, regions, "Все");
    setSelectOptions(els.filterProgram, programs, "Все");
  }

  function render() {
    refreshFiltersFromData();

    const filtered = applyFilters(db.instructions)
      .slice()
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

    els.cards.innerHTML = "";
    els.empty.hidden = filtered.length !== 0;

    const total = db.instructions.length;
    const expiredCount = db.instructions.filter((i) => computeStatus(i).isExpired).length;
    const shown = filtered.length;
    els.stats.textContent = `Показано: ${shown} из ${total}. Просрочено: ${expiredCount}.`;

    for (const i of filtered) {
      const { isExpired, isNear, isExpiredByDate } = computeStatus(i);
      const card = document.createElement("article");
      card.className = `card ${isExpired ? "card--expired" : isNear ? "card--near" : "card--ok"}`;
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.dataset.id = i.id;

      const badgeText = isExpired ? (i.isExpiredOverride ? "Просрочено (вручную)" : isExpiredByDate ? "Просрочено" : "Просрочено") : isNear ? "Скоро срок" : "Актуально";
      const badgeClass = isExpired ? "badge--expired" : isNear ? "badge--near" : "badge--ok";

      card.innerHTML = `
        <h3 class="card__title">${escapeText(i.title || "Без названия")}</h3>
        <div class="card__metaRow">
          <span class="badge ${badgeClass}">${escapeText(badgeText)}</span>
          <span class="badge">${escapeText(i.region || "—")}</span>
          <span class="badge">${escapeText(i.program || "—")}</span>
          <span class="badge">до ${escapeText(formatDue(i.dueDate))}</span>
        </div>
      `;

      card.addEventListener("click", () => openView(i.id));
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openView(i.id);
        }
      });

      els.cards.appendChild(card);
    }
  }

  function openView(id) {
    const i = db.instructions.find((x) => x.id === id);
    if (!i) return;
    selected = i;

    const { isExpired, isNear } = computeStatus(i);
    const statusText = isExpired ? "Просрочено" : isNear ? "Скоро срок" : "Актуально";
    els.viewTitle.textContent = i.title;
    els.viewMeta.textContent = `${i.region} · ${i.program} · действует до ${formatDue(i.dueDate)} · ${statusText}`;

    const safeHtml = sanitizeRichHtml(i.contentHtml);
    els.viewContent.innerHTML = safeHtml || "<div style='color:rgba(255,255,255,.7)'>Текст не задан.</div>";
    openModal("view");
  }

  async function copySelectedToClipboard() {
    if (!selected) return;
    const safeHtml = sanitizeRichHtml(selected.contentHtml || "");
    const title = selected.title || "";
    const meta = `${selected.region} · ${selected.program} · действует до ${formatDue(selected.dueDate)}`;
    const text = `${title}\n${meta}\n\n${els.viewContent.innerText || ""}`.trim();

    // Prefer rich copy (HTML + text). Fallback to plain text.
    try {
      if (window.ClipboardItem && navigator.clipboard?.write) {
        const htmlDoc = `<h2>${escapeText(title)}</h2><div>${escapeText(meta)}</div><hr />${safeHtml || ""}`;
        const item = new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([htmlDoc], { type: "text/html" }),
        });
        await navigator.clipboard.write([item]);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error("Clipboard API недоступен.");
      }
      setToast("Скопировано.");
    } catch {
      // Last resort: execCommand
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand("copy");
        setToast("Скопировано.");
      } catch {
        setToast("Не удалось скопировать.");
      } finally {
        ta.remove();
      }
    }
  }

  function openEditForNew() {
    editing = null;
    els.editTitle.textContent = "Новая инструкция";
    els.inpTitle.value = "";
    els.inpRegion.value = "";
    els.inpProgram.value = "";
    els.inpDueDate.value = todayYmd();
    els.inpExpiredOverride.checked = false;
    els.editError.hidden = true;
    els.editError.textContent = "";
    quill.setContents([]);
    openModal("edit");
    els.inpTitle.focus();
  }

  function openEditForExisting(id) {
    const i = db.instructions.find((x) => x.id === id);
    if (!i) return;
    editing = i;
    els.editTitle.textContent = "Редактирование";
    els.inpTitle.value = i.title;
    els.inpRegion.value = i.region;
    els.inpProgram.value = i.program;
    els.inpDueDate.value = i.dueDate || todayYmd();
    els.inpExpiredOverride.checked = Boolean(i.isExpiredOverride);
    els.editError.hidden = true;
    els.editError.textContent = "";
    quill.root.innerHTML = i.contentHtml || "";
    openModal("edit");
    els.inpTitle.focus();
  }

  function readForm() {
    const title = els.inpTitle.value.trim();
    const region = els.inpRegion.value.trim();
    const program = els.inpProgram.value.trim();
    const dueDate = els.inpDueDate.value;
    const isExpiredOverride = Boolean(els.inpExpiredOverride.checked);
    const contentHtml = sanitizeRichHtml(quill.root.innerHTML || "");
    return { title, region, program, dueDate, isExpiredOverride, contentHtml };
  }

  function validateForm(v) {
    if (!v.title) return "Заполните заголовок.";
    if (!v.region) return "Заполните регион.";
    if (!v.program) return "Заполните программу.";
    if (!v.dueDate) return "Укажите дату «действует до».";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.dueDate)) return "Неверный формат даты.";
    return "";
  }

  function upsertInstruction() {
    const v = readForm();
    const err = validateForm(v);
    if (err) {
      els.editError.textContent = err;
      els.editError.hidden = false;
      return;
    }

    if (!editing) {
      const inst = {
        id: safeId(),
        title: v.title,
        region: v.region,
        program: v.program,
        dueDate: v.dueDate,
        isExpiredOverride: v.isExpiredOverride,
        contentHtml: v.contentHtml,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      if (!HAS_REMOTE) {
        db.instructions.unshift(inst);
        saveDb();
        closeModal("edit");
        render();
        setToast("Инструкция добавлена.");
        return;
      }

      remoteUpsert(inst)
        .then((saved) => {
          if (!saved) throw new Error("Не удалось сохранить.");
          db.instructions.unshift(saved);
          saveDb();
          closeModal("edit");
          render();
          setToast("Инструкция добавлена.");
        })
        .catch((e) => {
          els.editError.textContent = e?.message || "Ошибка сохранения.";
          els.editError.hidden = false;
        });
      return;
    } else {
      const patch = {
        ...editing,
        title: v.title,
        region: v.region,
        program: v.program,
        dueDate: v.dueDate,
        isExpiredOverride: v.isExpiredOverride,
        contentHtml: v.contentHtml,
        updatedAt: nowIso(),
      };

      if (!HAS_REMOTE) {
        Object.assign(editing, patch);
        saveDb();
        closeModal("edit");
        render();
        setToast("Изменения сохранены.");
        return;
      }

      remoteUpsert(patch)
        .then((saved) => {
          if (!saved) throw new Error("Не удалось сохранить.");
          Object.assign(editing, saved);
          saveDb();
          closeModal("edit");
          render();
          setToast("Изменения сохранены.");
        })
        .catch((e) => {
          els.editError.textContent = e?.message || "Ошибка сохранения.";
          els.editError.hidden = false;
        });
      return;
    }
  }

  function deleteInstruction(id) {
    const idx = db.instructions.findIndex((x) => x.id === id);
    if (idx < 0) return;
    db.instructions.splice(idx, 1);
    saveDb();
    render();
    setToast("Удалено.");
  }

  function exportJson() {
    const payload = JSON.stringify(db, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `instructions_${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setToast("Экспорт готов.");
  }

  async function importJsonFile(file) {
    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Файл не является корректным JSON.");
    }
    const migrated = migrateDb(parsed);

    // Merge by id, prefer imported updatedAt
    const byId = new Map(db.instructions.map((i) => [i.id, i]));
    for (const i of migrated.instructions) {
      const existing = byId.get(i.id);
      if (!existing) {
        db.instructions.push(i);
        byId.set(i.id, i);
        continue;
      }
      if ((existing.updatedAt || "") < (i.updatedAt || "")) {
        Object.assign(existing, i);
      }
    }

    // Normalize & sort
    db.instructions = db.instructions.map((x) => normalizeInstruction(x)).filter(Boolean);
    db.version = SCHEMA_VERSION;
    saveDb();
    render();
    setToast("Импорт завершён.");
  }

  function wireUi() {
    els.btnAdd.addEventListener("click", openEditForNew);
    els.btnExport.addEventListener("click", exportJson);
    els.btnImport.addEventListener("click", () => els.fileImport.click());
    els.fileImport.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      try {
        await importJsonFile(file);
      } catch (err) {
        setToast(err?.message || "Ошибка импорта.");
      }
    });

    els.filterRegion.addEventListener("change", render);
    els.filterProgram.addEventListener("change", render);
    els.filterQuery.addEventListener("input", () => {
      // tiny debounce via rAF
      window.requestAnimationFrame(render);
    });

    // Modal close handlers
    document.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const closeKind = target.getAttribute("data-close");
      if (closeKind === "view") closeModal("view");
      if (closeKind === "edit") closeModal("edit");
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (els.editModal.classList.contains("isOpen")) closeModal("edit");
      else if (els.viewModal.classList.contains("isOpen")) closeModal("view");
    });

    els.btnEditFromView.addEventListener("click", () => {
      if (!selected) return;
      closeModal("view");
      openEditForExisting(selected.id);
    });

    els.btnDeleteFromView.addEventListener("click", () => {
      if (!selected) return;
      const ok = window.confirm("Удалить инструкцию? Это действие нельзя отменить.");
      if (!ok) return;
      const id = selected.id;
      selected = null;
      closeModal("view");
      if (!HAS_REMOTE) {
        deleteInstruction(id);
        return;
      }
      remoteDelete(id)
        .then(() => {
          deleteInstruction(id);
        })
        .catch((err) => {
          setToast(err?.message || "Ошибка удаления.");
        });
    });

    els.btnCopyFromView.addEventListener("click", () => {
      copySelectedToClipboard();
    });

    els.editForm.addEventListener("submit", (e) => {
      e.preventDefault();
      upsertInstruction();
    });

    const clearError = () => {
      els.editError.hidden = true;
      els.editError.textContent = "";
    };
    els.inpTitle.addEventListener("input", clearError);
    els.inpRegion.addEventListener("input", clearError);
    els.inpProgram.addEventListener("input", clearError);
    els.inpDueDate.addEventListener("change", clearError);
    els.inpExpiredOverride.addEventListener("change", clearError);
    quill.on("text-change", clearError);
  }

  function bootstrap() {
    db = loadDb();
    initQuill();
    wireUi();
    if (!HAS_REMOTE) {
      render();
      return;
    }

    els.stats.textContent = "Загрузка из облака…";
    remoteList()
      .then((instructions) => {
        db.instructions = instructions;
        db.version = SCHEMA_VERSION;
        saveDb();
        render();
        setToast("Облако подключено.");
      })
      .catch((err) => {
        render();
        setToast(err?.message || "Не удалось загрузить облако (работаем локально).");
      });
  }

  window.addEventListener("DOMContentLoaded", bootstrap);
})();

