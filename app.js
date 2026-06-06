const STORAGE_KEY = "case-calendar-v1";
const SYNC_SETTINGS_KEY = "case-calendar-sync-settings-v1";
const SYNC_FILE_PATH = "calendar-data.json";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const els = {
  todayText: document.querySelector("#todayText"),
  startDate: document.querySelector("#startDate"),
  endDate: document.querySelector("#endDate"),
  todayBtn: document.querySelector("#todayBtn"),
  addCaseBtns: document.querySelectorAll(".add-case-btn"),
  addTodoBtn: document.querySelector("#addTodoBtn"),
  syncOwner: document.querySelector("#syncOwner"),
  syncRepo: document.querySelector("#syncRepo"),
  syncToken: document.querySelector("#syncToken"),
  saveSyncSettingsBtn: document.querySelector("#saveSyncSettingsBtn"),
  pullSyncBtn: document.querySelector("#pullSyncBtn"),
  pushSyncBtn: document.querySelector("#pushSyncBtn"),
  syncStatus: document.querySelector("#syncStatus"),
  dirtyStatus: document.querySelector("#dirtyStatus"),
  syncPanel: document.querySelector(".sync-panel"),
  toast: document.querySelector("#toast"),
  calendar: document.querySelector("#calendar"),
  overdueList: document.querySelector("#overdueList"),
  unpaidList: document.querySelector("#unpaidList"),
  itemDialog: document.querySelector("#itemDialog"),
  itemForm: document.querySelector("#itemForm"),
  dialogTitle: document.querySelector("#dialogTitle"),
  closeDialogBtn: document.querySelector("#closeDialogBtn"),
  cancelBtn: document.querySelector("#cancelBtn"),
  deleteBtn: document.querySelector("#deleteBtn"),
  itemId: document.querySelector("#itemId"),
  itemKind: document.querySelector("#itemKind"),
  caseFields: document.querySelector("#caseFields"),
  caseType: document.querySelector("#caseType"),
  deadlineLabel: document.querySelector("#deadlineLabel"),
  deadline: document.querySelector("#deadline"),
  deadlinePicker: document.querySelector("#deadlinePicker"),
  workloadLabel: document.querySelector("#workloadLabel"),
  wordCount: document.querySelector("#wordCount"),
  status: document.querySelector("#status"),
  title: document.querySelector("#title"),
  todoDateWrap: document.querySelector("#todoDateWrap"),
  todoDate: document.querySelector("#todoDate"),
  noteWrap: document.querySelector("#noteWrap"),
  isNote: document.querySelector("#isNote"),
  notes: document.querySelector("#notes"),
  importWrap: document.querySelector("#importWrap"),
  importText: document.querySelector("#importText"),
  importBtn: document.querySelector("#importBtn"),
  contextMenu: document.querySelector("#contextMenu"),
};

let state = loadState();
let activeFilter = "all";
let hasUnsyncedChanges = false;
let isApplyingRemoteState = false;

function todayDate() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function toISO(date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function fromISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return d;
}

function endOfWeek(date) {
  return addDays(startOfWeek(date), 6);
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) return JSON.parse(saved);

  const today = todayDate();
  return {
    rangeStart: toISO(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
    rangeEnd: toISO(new Date(today.getFullYear(), today.getMonth() + 2, 0)),
    items: [],
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function markUnsynced() {
  if (isApplyingRemoteState) return;
  hasUnsyncedChanges = true;
  updateDirtyStatus();
}

function markSynced() {
  hasUnsyncedChanges = false;
  updateDirtyStatus();
}

function updateDirtyStatus() {
  els.dirtyStatus.classList.toggle("hidden", !hasUnsyncedChanges);
  els.dirtyStatus.classList.toggle("unsynced", hasUnsyncedChanges);
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    els.toast.classList.add("hidden");
  }, 1000);
}

function loadSyncSettings() {
  const saved = localStorage.getItem(SYNC_SETTINGS_KEY);
  if (!saved) return;
  const settings = JSON.parse(saved);
  els.syncOwner.value = settings.owner || "hanx012";
  els.syncRepo.value = settings.repo || "calendar-data";
  els.syncToken.value = settings.token || "";
  setSyncStatus(settings.token ? "同步设置已保存，建议先从 GitHub 拉取" : "未设置 token");
}

function saveSyncSettings() {
  const settings = getSyncSettings();
  localStorage.setItem(SYNC_SETTINGS_KEY, JSON.stringify(settings));
  setSyncStatus("同步设置已保存");
}

function getSyncSettings() {
  return {
    owner: els.syncOwner.value.trim(),
    repo: els.syncRepo.value.trim(),
    token: els.syncToken.value.trim(),
  };
}

function setSyncStatus(message) {
  els.syncStatus.textContent = message;
}

function validateSyncSettings() {
  const settings = getSyncSettings();
  if (!settings.owner || !settings.repo || !settings.token) {
    setSyncStatus("请先填写用户名、数据仓库和 token");
    return null;
  }
  return settings;
}

function githubFileUrl(settings) {
  return `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${SYNC_FILE_PATH}`;
}

async function fetchGithubData(settings) {
  const response = await fetch(githubFileUrl(settings), {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${settings.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub 读取失败：${response.status}`);
  return response.json();
}

function encodeBase64Utf8(value) {
  return btoa(unescape(encodeURIComponent(value)));
}

function decodeBase64Utf8(value) {
  return decodeURIComponent(escape(atob(value.replace(/\n/g, ""))));
}

function makeSyncPayload() {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    state,
  };
}

async function pullFromGithub() {
  const settings = validateSyncSettings();
  if (!settings) return;
  if (state.items.length && !confirm("从 GitHub 拉取会覆盖当前浏览器里的日历数据，确定继续吗？")) return;

  setSyncStatus("正在从 GitHub 拉取...");
  try {
    const file = await fetchGithubData(settings);
    if (!file) {
      setSyncStatus("GitHub 上还没有数据文件，可以先点“保存到 GitHub”");
      return;
    }

    const payload = JSON.parse(decodeBase64Utf8(file.content));
    isApplyingRemoteState = true;
    state = payload.state || payload;
    saveState();
    render();
    isApplyingRemoteState = false;
    markSynced();
    showToast("已拉取");
    setSyncStatus(`已拉取：${payload.savedAt ? new Date(payload.savedAt).toLocaleString() : "完成"}`);
  } catch (error) {
    isApplyingRemoteState = false;
    setSyncStatus(error.message);
  }
}

async function pushToGithub() {
  const settings = validateSyncSettings();
  if (!settings) return;

  setSyncStatus("正在保存到 GitHub...");
  try {
    const existing = await fetchGithubData(settings);
    const body = {
      message: `Update calendar data ${new Date().toISOString()}`,
      content: encodeBase64Utf8(JSON.stringify(makeSyncPayload(), null, 2)),
    };
    if (existing?.sha) body.sha = existing.sha;

    const response = await fetch(githubFileUrl(settings), {
      method: "PUT",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${settings.token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) throw new Error(`GitHub 保存失败：${response.status}`);
    markSynced();
    showToast("已保存");
    setSyncStatus(`已保存：${new Date().toLocaleString()}`);
  } catch (error) {
    setSyncStatus(error.message);
  }
}

function isOverdue(item) {
  if (item.status === "overdue") return true;
  if (item.status === "done" || item.status === "paid") return false;
  const referenceDate = item.deadline || item.date;
  return fromISO(referenceDate) < todayDate();
}

function displayStatus(item) {
  if (isOverdue(item)) return "overdue";
  return item.status || "active";
}

function itemTypeLabel(type) {
  return { translate: "翻译", proofread: "校对", oa: "OA" }[type] || "";
}

function render() {
  saveState();
  els.startDate.value = state.rangeStart;
  els.endDate.value = state.rangeEnd;
  els.todayText.textContent = `今天是 ${toISO(todayDate())}`;
  renderCalendar();
  renderSidebars();
}

function renderCalendar() {
  els.calendar.innerHTML = "";
  const start = startOfWeek(fromISO(state.rangeStart));
  const end = endOfWeek(fromISO(state.rangeEnd));
  const todayIso = toISO(todayDate());

  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 7)) {
    const week = document.createElement("div");
    week.className = "week";

    const monthMark = document.createElement("div");
    monthMark.className = "month-mark";
    const visibleDays = Array.from({ length: 7 }, (_, i) => addDays(cursor, i));
    const rangeStart = fromISO(state.rangeStart);
    const startsMonth = visibleDays.find((d) => d.getDate() === 1 && d >= rangeStart && d <= fromISO(state.rangeEnd));
    const isFirstVisibleWeek = visibleDays.some((d) => toISO(d) === state.rangeStart);
    monthMark.textContent = startsMonth ? startsMonth.getMonth() + 1 : isFirstVisibleWeek ? rangeStart.getMonth() + 1 : "";
    week.append(monthMark);

    for (const day of visibleDays) {
      const iso = toISO(day);
      const dayEl = document.createElement("div");
      dayEl.className = `day month-${["a", "b", "c", "d"][day.getMonth() % 4]}`;
      if (day.getDay() === 0 || day.getDay() === 6) dayEl.classList.add("weekend");
      if (iso === todayIso) dayEl.classList.add("today");
      dayEl.dataset.date = iso;
      dayEl.addEventListener("dragover", (event) => event.preventDefault());
      dayEl.addEventListener("drop", onDropItem);

      const head = document.createElement("div");
      head.className = "day-head";
      head.textContent = day.getDate();
      head.addEventListener("click", (event) => {
        event.stopPropagation();
        openDialog("todo", null, iso);
      });
      dayEl.append(head);

      const list = document.createElement("div");
      list.className = "items";
      getItemsForDate(iso).forEach((item) => list.append(renderItem(item)));
      dayEl.append(list);
      week.append(dayEl);
    }
    els.calendar.append(week);
  }
}

function getItemsForDate(iso) {
  return state.items
    .filter((item) => item.date === iso)
    .filter((item) => {
      if (activeFilter === "all") return true;
      if (activeFilter === "overdue") return isOverdue(item);
      return item.kind === activeFilter;
    })
    .sort((a, b) => (a.kind === b.kind ? a.title.localeCompare(b.title, "zh-CN") : a.kind.localeCompare(b.kind)));
}

function renderItem(item) {
  const el = document.createElement("div");
  const status = displayStatus(item);
  el.className = `item ${item.kind} ${item.caseType || ""} ${status}`;
  el.draggable = true;
  el.dataset.id = item.id;
  el.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", item.id));
  el.addEventListener("click", (event) => showContextMenu(event, item.id));
  el.addEventListener("dblclick", (event) => {
    event.stopPropagation();
    hideContextMenu();
    openDialog(item.kind, item);
  });

  if (item.kind === "todo") {
    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "todo-check";
    check.checked = item.status === "done";
    check.addEventListener("click", (event) => {
      event.stopPropagation();
      updateItem(item.id, { status: check.checked ? "done" : "active" });
    });
    el.append(check);
  } else if (item.kind === "note") {
    const mark = document.createElement("span");
    mark.className = "note-mark";
    mark.textContent = "◆";
    el.append(mark);
  } else {
    const dot = document.createElement("span");
    dot.className = `dot ${item.caseType}`;
    el.append(dot);
  }

  const text = document.createElement("div");
  const meta =
    item.kind === "case"
      ? `${itemTypeLabel(item.caseType)} ${item.wordCount || ""} ${item.notes || ""}`.trim()
      : item.kind === "note"
        ? `笔记 ${item.notes || ""}`.trim()
        : `${item.notes || ""}`.trim();
  text.innerHTML = `<strong>${escapeHtml(item.title)}</strong>${meta ? `<br>${escapeHtml(meta)}` : ""}`;
  el.append(text);
  return el;
}

function renderSidebars() {
  const overdue = state.items
    .filter((item) => item.kind === "case" && isOverdue(item))
    .sort((a, b) => fromISO(a.deadline || a.date) - fromISO(b.deadline || b.date))
    .slice(0, 12);
  const unpaid = state.items
    .filter((item) => item.kind === "case" && item.status === "done")
    .sort((a, b) => fromISO(a.deadline || a.date) - fromISO(b.deadline || b.date))
    .slice(0, 12);

  renderMiniList(els.overdueList, overdue, "没有已过期案件");
  renderMiniList(els.unpaidList, unpaid, "没有未结款案件");
}

function renderMiniList(container, items, emptyText) {
  container.innerHTML = items.length ? "" : `<div class='muted'>${emptyText}</div>`;
  items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "mini-card";
    card.textContent = `${item.date} ${item.title}`;
    card.addEventListener("dblclick", () => openDialog(item.kind, item));
    container.append(card);
  });
}

function showContextMenu(event, id) {
  event.stopPropagation();
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  const actions = [
    ["进行中", () => updateItem(id, { status: "active" })],
    ["已过期", () => updateItem(id, { status: "overdue" })],
    ["已完成", () => updateItem(id, { status: "done" })],
    ["已结款", () => updateItem(id, { status: "paid" })],
    ["删除", () => deleteItem(id)],
  ];
  els.contextMenu.innerHTML = "";
  actions.forEach(([label, action]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => {
      action();
      hideContextMenu();
    });
    els.contextMenu.append(button);
  });
  els.contextMenu.style.left = `${Math.min(event.clientX, window.innerWidth - 190)}px`;
  els.contextMenu.style.top = `${Math.min(event.clientY, window.innerHeight - 260)}px`;
  els.contextMenu.classList.remove("hidden");
}

function hideContextMenu() {
  els.contextMenu.classList.add("hidden");
}

function openDialog(kind, item = null, date = null) {
  els.itemForm.reset();
  els.importText.innerHTML = "";
  els.itemKind.value = kind;
  els.itemId.value = item?.id || "";
  els.dialogTitle.textContent = item ? "编辑项目" : kind === "case" ? "添加案件" : "添加待办";
  els.caseFields.classList.toggle("hidden", kind !== "case");
  els.todoDateWrap.classList.toggle("hidden", kind === "case");
  els.noteWrap.classList.toggle("hidden", kind === "case");
  els.importWrap.classList.toggle("hidden", kind !== "case");
  els.deleteBtn.classList.toggle("hidden", !item);

  if (item) {
    els.title.value = item.title;
    els.notes.value = item.notes || "";
    els.status.value = item.status || "active";
    els.caseType.value = item.caseType || "translate";
    els.deadline.value = item.deadline || item.date;
    els.deadlinePicker.value = item.deadline || item.date;
    els.wordCount.value = item.wordCount || "";
    els.todoDate.value = item.date;
    els.isNote.checked = item.kind === "note";
  } else {
    const fallback = date || toISO(todayDate());
    els.deadline.value = fallback;
    els.deadlinePicker.value = fallback;
    els.todoDate.value = fallback;
    els.status.value = "active";
    els.isNote.checked = false;
  }
  if (kind === "case") updateCaseFormCopy();
  else {
    els.dialogTitle.textContent = item ? (item.kind === "note" ? "编辑笔记" : "编辑待办") : "添加待办";
    els.importWrap.classList.add("hidden");
  }
  if (kind !== "case") applyTodoDialogMode(item);
  els.itemDialog.showModal();
}

function applyTodoDialogMode(item = null) {
  els.itemKind.value = item?.kind || "todo";
  els.dialogTitle.textContent = item ? (item.kind === "note" ? "编辑笔记" : "编辑待办") : "添加待办";
  els.caseFields.classList.add("hidden");
  els.todoDateWrap.classList.remove("hidden");
  els.noteWrap.classList.remove("hidden");
  els.importWrap.classList.add("hidden");
}

function openCaseDialog(caseType) {
  openDialog("case");
  els.caseType.value = caseType;
  updateCaseFormCopy();
}

function closeDialog() {
  els.itemDialog.close();
}

function saveFromDialog(event) {
  event.preventDefault();
  let kind = els.itemKind.value;
  if (kind === "todo" && els.isNote.checked) kind = "note";
  const id = els.itemId.value || crypto.randomUUID();
  const base = {
    id,
    kind,
    title: els.title.value.trim(),
    notes: els.notes.value.trim(),
    status: els.status.value,
  };

  let item;
  if (kind === "case") {
    const deadline = normalizeDateInput(els.deadline.value) || toISO(todayDate());
    const caseType = els.caseType.value;
    item = {
      ...base,
      caseType,
      deadline,
      wordCount: els.wordCount.value.trim(),
      date: caseType === "oa" ? toISO(addMonths(fromISO(deadline), -1)) : deadline,
    };
  } else {
    item = {
      ...base,
      date: normalizeDateInput(els.todoDate.value) || toISO(todayDate()),
    };
  }

  const existingIndex = state.items.findIndex((entry) => entry.id === id);
  if (existingIndex >= 0) state.items[existingIndex] = item;
  else state.items.push(item);
  markUnsynced();
  closeDialog();
  render();
}

function updateItem(id, patch) {
  state.items = state.items.map((item) => (item.id === id ? { ...item, ...patch } : item));
  markUnsynced();
  render();
}

function shiftItem(id, days) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  const patch = { date: toISO(addDays(fromISO(item.date), days)) };
  if (item.deadline && item.caseType !== "oa") patch.deadline = toISO(addDays(fromISO(item.deadline), days));
  updateItem(id, patch);
}

function deleteItem(id) {
  state.items = state.items.filter((item) => item.id !== id);
  markUnsynced();
  render();
}

function onDropItem(event) {
  const id = event.dataTransfer.getData("text/plain");
  const date = event.currentTarget.dataset.date;
  const item = state.items.find((entry) => entry.id === id);
  if (!item || !date) return;
  const patch = { date };
  if (item.kind === "case" && item.caseType !== "oa") patch.deadline = date;
  if (item.kind === "case" && isOverdue(item)) patch.status = "overdue";
  updateItem(id, patch);
}

function normalizeDateInput(value) {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return "";
  const parsed = fromISO(trimmed);
  return Number.isNaN(parsed.getTime()) ? "" : trimmed;
}

function updateCaseFormCopy() {
  if (els.itemKind.value !== "case") return;
  const type = els.caseType.value;
  if (type === "oa") {
    els.dialogTitle.textContent = els.itemId.value ? "编辑OA" : "添加OA";
    els.deadlineLabel.textContent = "期限（自动记录到提前一个月）";
    els.workloadLabel.textContent = "工作量";
    els.wordCount.placeholder = "例如 预计账单 13h";
    els.notes.placeholder = "可写OA类型、简要意见、特殊指示等";
  } else {
    els.dialogTitle.textContent = els.itemId.value ? (type === "translate" ? "编辑翻译" : "编辑校对") : type === "translate" ? "添加翻译" : "添加校对";
    els.deadlineLabel.textContent = "期限";
    els.workloadLabel.textContent = "字数/修改小时数";
    els.wordCount.placeholder = "例如 8859 / 4h";
    els.notes.placeholder = "可写绝限、客户、特殊指示等";
  }
  els.importWrap.classList.remove("hidden");
  els.title.placeholder = "例如 尾号1234+发明名称";
}

function importPastedCase() {
  const parsed = parseCasePaste(getImportText());
  if (!parsed) {
    alert("没有识别到可导入的表格内容。可以先把原表格复制后直接粘贴进来。");
    return;
  }

  const caseType = els.caseType.value;
  const caseNo = pickField(parsed, ["集佳案号", "委托人案号"]);
  const tail = caseNo.match(/(\d{4})(?!.*\d)/)?.[1] || caseNo;
  const invention = pickField(parsed, ["发明名称", "发明中文"]);
  const title = [tail, invention].filter(Boolean).join(" ");
  const finalDate = normalizeLooseDate(pickField(parsed, ["上报期限", "绝限"]));
  const note = pickField(parsed, ["案卷备注", "备注"]);

  els.title.value = title || els.title.value;
  els.wordCount.value = pickField(parsed, ["字数", "工作量"]) || els.wordCount.value;
  els.notes.value = [`绝限 ${finalDate || pickField(parsed, ["上报期限", "绝限"])}`, note].filter(Boolean).join("；");

  const deadlineByType = {
    translate: pickField(parsed, ["翻译期限"]),
    proofread: pickField(parsed, ["客户要求返稿日"]) || pickField(parsed, ["部门返初稿期限"]),
    oa: pickField(parsed, ["绝限"]),
  };
  els.deadline.value = normalizeLooseDate(deadlineByType[caseType] || "") || els.deadline.value;
}

function getImportText() {
  const table = els.importText.querySelector("table");
  if (table) {
    return Array.from(table.rows)
      .map((row) => Array.from(row.cells).map((cell) => cell.textContent.trim()).join("\t"))
      .join("\n");
  }
  return els.importText.innerText || "";
}

function parseCasePaste(text) {
  const tableParsed = parseStructuredTableText(text);
  if (tableParsed) return tableParsed;

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const knownFields = [
    "技术领域",
    "集佳案号",
    "绝限",
    "委托人案号",
    "任务",
    "发明序号",
    "国家",
    "发明中文",
    "发明名称",
    "第一申请人",
    "委托人",
    "案源人",
    "字数",
    "办案人",
    "翻译组",
    "翻译人",
    "校对人",
    "上报期限",
    "翻译期限",
    "客户要求返稿日",
    "部门返初稿期限",
    "第一代理人",
    "案卷备注",
    "备注",
    "目标语种",
    "优先权信息",
    "PCT申请号",
    "PCT公开号",
    "PCT进入途径",
    "申请途径",
  ];
  const firstValueIndex = lines.findIndex((line, index) => index > 0 && !knownFields.includes(line));
  if (firstValueIndex < 0) return null;
  const headers = lines.slice(0, firstValueIndex);
  const values = lines.slice(firstValueIndex);
  const result = {};
  headers.forEach((header, index) => {
    result[header] = values[index] || "";
  });

  const compact = lines.join("\n");
  const caseNo = compact.match(/[A-Z]{1,4}\d{4,}-[A-Z]{2,}-\d{3,}/)?.[0];
  if (caseNo) result["集佳案号"] = caseNo;

  const numbers = values.filter((line) => /^\d{3,6}$/.test(line));
  if (numbers.length) result["字数"] = numbers[0];

  const dates = values.map(normalizeLooseDate).filter(Boolean);
  if (dates[0] && !result["上报期限"]) result["上报期限"] = dates[0];
  if (dates[1] && !result["翻译期限"]) result["翻译期限"] = dates[1];
  if (dates[2] && !result["客户要求返稿日"]) result["客户要求返稿日"] = dates[2];
  if (dates[3] && !result["部门返初稿期限"]) result["部门返初稿期限"] = dates[3];
  if (dates[2] && !dates[3] && !result["部门返初稿期限"]) result["部门返初稿期限"] = dates[2];

  const countries = ["欧洲", "美国", "日本", "韩国", "中国", "德国", "法国", "英国", "加拿大", "澳大利亚"];
  const countryIndex = values.findIndex((line) => countries.includes(line));
  if (countryIndex >= 0 && values[countryIndex + 1]) result["发明中文"] = values[countryIndex + 1];

  const languageIndex = values.findIndex((line) => ["英语", "日语", "韩语", "德语", "法语"].includes(line));
  if (languageIndex > 0) {
    const beforeLanguage = values.slice(0, languageIndex);
    const note = [...beforeLanguage].reverse().find((line) => /[；;。]/.test(line) || line.length > 18);
    if (note) result["案卷备注"] = note;
  }
  return result;
}

function parseStructuredTableText(text) {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.split("\t").map((cell) => cell.trim()))
    .filter((row) => row.some(Boolean));
  if (!rows.length || rows.every((row) => row.length < 2)) return null;

  const result = {};
  const headerRowIndex = rows.findIndex((row) => row.includes("集佳案号") && row.includes("发明中文"));
  if (headerRowIndex >= 0 && rows[headerRowIndex + 1]) {
    rows[headerRowIndex].forEach((header, index) => {
      result[header] = rows[headerRowIndex + 1][index] || "";
    });
    return result;
  }

  rows.forEach((row) => {
    if (row.length >= 2 && row[0]) result[row[0]] = row[1] || "";
  });
  return Object.keys(result).length ? result : null;
}

function normalizeLooseDate(value) {
  const match = value.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!match) return "";
  const [, y, m, d] = match;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function pickField(record, names) {
  for (const name of names) {
    const value = record[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function setDeadline(value) {
  const normalized = normalizeLooseDate(value) || normalizeDateInput(value);
  if (!normalized) return;
  els.deadline.value = normalized;
  els.deadlinePicker.value = normalized;
}

function updateCaseFormCopy() {
  if (els.itemKind.value !== "case") return;
  const type = els.caseType.value;
  if (type === "oa") {
    els.dialogTitle.textContent = els.itemId.value ? "编辑OA" : "添加OA";
    els.deadlineLabel.textContent = "期限（自动记录到提前一个月）";
    els.workloadLabel.textContent = "工作量";
    els.wordCount.placeholder = "例如 预计账单 13h";
    els.notes.placeholder = "可写OA类型、简要意见、特殊指示等";
  } else {
    els.dialogTitle.textContent = els.itemId.value ? (type === "translate" ? "编辑翻译" : "编辑校对") : type === "translate" ? "添加翻译" : "添加校对";
    els.deadlineLabel.textContent = "期限";
    els.workloadLabel.textContent = "字数/修改小时数";
    els.wordCount.placeholder = "例如 8859 / 4h";
    els.notes.placeholder = "可写绝限、客户、特殊指示等";
  }
  els.importWrap.classList.remove("hidden");
  els.title.placeholder = "例如 尾号1234+发明名称";
}

function importPastedCase() {
  const importText = getImportText();
  const parsed = parseCasePaste(importText);
  if (!parsed) {
    alert("没有识别到可导入的表格内容。可以先把原表格复制后直接粘贴进来。");
    return;
  }

  if (els.caseType.value === "oa") importOaCase(parsed);
  else importTranslateOrProofreadCase(parsed, els.caseType.value, importText);
}

function importOaCase(parsed) {
  fillCommonImportedTitle(parsed);
  const deadline = normalizeLooseDate(pickField(parsed, ["绝限"]));
  if (deadline) setDeadline(deadline);
}

function importTranslateOrProofreadCase(parsed, caseType, importText) {
  fillCommonImportedTitle(parsed);
  els.wordCount.value = pickField(parsed, ["字数"]) || els.wordCount.value;

  const finalDate = normalizeLooseDate(pickField(parsed, ["上报期限", "绝限"]));
  const note = pickField(parsed, ["案卷备注", "备注"]);
  els.notes.value = [`绝限 ${finalDate || pickField(parsed, ["上报期限", "绝限"])}`, note].filter(Boolean).join("；");

  const deadline = extractTranslateProofreadDeadline(importText, caseType);
  if (deadline) setDeadline(deadline);
}

function fillCommonImportedTitle(parsed) {
  const caseNo = pickField(parsed, ["集佳案号", "委托人案号"]);
  const tail = caseNo.match(/(\d{4})(?!.*\d)/)?.[1] || caseNo;
  const invention = pickField(parsed, ["发明名称", "发明中文"]);
  const title = [tail, invention].filter(Boolean).join(" ");
  if (title) els.title.value = title;
}

function extractTranslateProofreadDeadline(text, caseType) {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.split("\t").map((cell) => cell.trim()))
    .filter((row) => row.some(Boolean));

  const fromTable =
    caseType === "translate"
      ? findDateByTableLabel(rows, "翻译期限")
      : findDateByTableLabel(rows, "客户要求返稿日") || findDateByTableLabel(rows, "部门返初稿期限");
  if (fromTable) return fromTable;

  const dates = text
    .split(/\r?\n/)
    .map((line) => normalizeLooseDate(line))
    .filter(Boolean);

  if (caseType === "translate") return dates[1] || "";
  return dates[2] || "";
}

function findDateByTableLabel(rows, label) {
  const target = normalizeFieldName(label);

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const colIndex = row.findIndex((cell) => normalizeFieldName(cell) === target);
    if (colIndex < 0) continue;

    const sameRowValue = normalizeLooseDate(row.slice(colIndex + 1).join(" "));
    if (sameRowValue) return sameRowValue;

    if (rows[rowIndex + 1]) {
      const nextRowValue = normalizeLooseDate(rows[rowIndex + 1][colIndex] || "");
      if (nextRowValue) return nextRowValue;
    }
  }

  return "";
}

function parseCasePaste(text) {
  const structured = parseStructuredTableText(text);
  if (structured) return structured;

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return null;

  const knownFields = [
    "技术领域",
    "集佳案号",
    "绝限",
    "委托人案号",
    "任务",
    "发明序号",
    "国家",
    "发明中文",
    "发明名称",
    "第一申请人",
    "委托人",
    "案源人",
    "字数",
    "办案人",
    "翻译组",
    "翻译人",
    "校对人",
    "上报期限",
    "翻译期限",
    "客户要求返稿日",
    "部门返初稿期限",
    "第一代理人",
    "案卷备注",
    "备注",
    "目标语种",
    "优先权信息",
    "PCT申请号",
    "PCT公开号",
    "PCT进入途径",
    "申请途径",
  ];

  const result = {};
  const firstValueIndex = lines.findIndex((line, index) => index > 0 && !knownFields.includes(line));
  if (firstValueIndex > 0) {
    const headers = lines.slice(0, firstValueIndex);
    const values = lines.slice(firstValueIndex);
    headers.forEach((header, index) => {
      result[header] = values[index] || "";
    });
  }

  const compact = lines.join("\n");
  const caseNo = compact.match(/[A-Z]{1,4}\d{4,}-[A-Z]{2,}-\d{3,}/)?.[0];
  if (caseNo) result["集佳案号"] = caseNo;

  const numbers = lines.filter((line) => /^\d{3,6}$/.test(line));
  if (numbers.length && !result["字数"]) result["字数"] = numbers[0];

  const dates = lines.map(normalizeLooseDate).filter(Boolean);
  if (dates[0] && !result["上报期限"]) result["上报期限"] = dates[0];
  if (dates[1] && !result["翻译期限"]) result["翻译期限"] = dates[1];
  if (dates[2] && !result["客户要求返稿日"]) result["客户要求返稿日"] = dates[2];
  if (dates[3] && !result["部门返初稿期限"]) result["部门返初稿期限"] = dates[3];
  if (dates[2] && !dates[3] && !result["部门返初稿期限"]) result["部门返初稿期限"] = dates[2];
  if (dates[0] && !result["绝限"]) result["绝限"] = dates[0];

  fillDateAfterLabel(result, lines, "翻译期限");
  fillDateAfterLabel(result, lines, "客户要求返稿日");
  fillDateAfterLabel(result, lines, "部门返初稿期限");
  fillDateAfterLabel(result, lines, "上报期限");
  fillDateAfterLabel(result, lines, "绝限");

  const countries = ["欧洲", "美国", "日本", "韩国", "中国", "德国", "法国", "英国", "加拿大", "澳大利亚"];
  const countryIndex = lines.findIndex((line) => countries.includes(line));
  if (countryIndex >= 0 && lines[countryIndex + 1]) result["发明中文"] = lines[countryIndex + 1];

  return Object.keys(result).length ? result : null;
}

function parseStructuredTableText(text) {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.split("\t").map((cell) => cell.trim()))
    .filter((row) => row.some(Boolean));
  if (!rows.length || rows.every((row) => row.length < 2)) return null;

  const result = {};
  const headerRowIndex = rows.findIndex((row) => row.includes("集佳案号") && (row.includes("发明中文") || row.includes("发明名称")));
  if (headerRowIndex >= 0 && rows[headerRowIndex + 1]) {
    rows[headerRowIndex].forEach((header, index) => {
      result[header] = rows[headerRowIndex + 1][index] || "";
    });
    return result;
  }

  rows.forEach((row) => {
    if (row.length >= 2 && row[0]) result[row[0]] = row[1] || "";
  });
  return Object.keys(result).length ? result : null;
}

function normalizeLooseDate(value) {
  const match = String(value || "").match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!match) return "";
  const [, y, m, d] = match;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function pickField(record, names) {
  for (const name of names) {
    const value = record[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  const entries = Object.entries(record);
  for (const name of names) {
    const normalizedName = normalizeFieldName(name);
    const found = entries.find(([key, value]) => normalizeFieldName(key) === normalizedName && value && String(value).trim());
    if (found) return String(found[1]).trim();
  }
  for (const name of names) {
    const normalizedName = normalizeFieldName(name);
    const found = entries.find(([key, value]) => normalizeFieldName(key).includes(normalizedName) && value && String(value).trim());
    if (found) return String(found[1]).trim();
  }
  return "";
}

function fillDateAfterLabel(result, lines, label) {
  if (result[label]) return;
  const labelIndex = lines.findIndex((line) => normalizeFieldName(line).includes(normalizeFieldName(label)));
  if (labelIndex < 0) return;
  const nearby = lines.slice(labelIndex + 1, labelIndex + 8).map(normalizeLooseDate).find(Boolean);
  if (nearby) result[label] = nearby;
}

function normalizeFieldName(value) {
  return String(value || "").replace(/\s+/g, "").replace(/[：:]/g, "").trim();
}

els.startDate.addEventListener("change", () => {
  state.rangeStart = els.startDate.value;
  markUnsynced();
  render();
});
els.endDate.addEventListener("change", () => {
  state.rangeEnd = els.endDate.value;
  markUnsynced();
  render();
});
els.todayBtn.addEventListener("click", () => {
  document.querySelector(".day.today")?.scrollIntoView({ block: "center" });
});
els.addCaseBtns.forEach((button) => {
  button.addEventListener("click", () => {
    openCaseDialog(button.dataset.caseType);
  });
});
els.addTodoBtn.addEventListener("click", () => openDialog("todo"));
els.saveSyncSettingsBtn.addEventListener("click", saveSyncSettings);
els.pullSyncBtn.addEventListener("click", pullFromGithub);
els.pushSyncBtn.addEventListener("click", pushToGithub);
els.caseType.addEventListener("change", updateCaseFormCopy);
els.deadline.addEventListener("input", () => {
  const normalized = normalizeLooseDate(els.deadline.value) || normalizeDateInput(els.deadline.value);
  if (normalized) els.deadlinePicker.value = normalized;
});
els.deadlinePicker.addEventListener("change", () => {
  if (els.deadlinePicker.value) els.deadline.value = els.deadlinePicker.value;
});
els.importText.addEventListener("click", (event) => event.stopPropagation());
els.importBtn.addEventListener("click", importPastedCase);
els.closeDialogBtn.addEventListener("click", closeDialog);
els.cancelBtn.addEventListener("click", closeDialog);
els.itemForm.addEventListener("submit", saveFromDialog);
els.deleteBtn.addEventListener("click", () => {
  if (els.itemId.value) deleteItem(els.itemId.value);
  closeDialog();
});
document.querySelectorAll(".filter").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".filter").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    activeFilter = button.dataset.filter;
    render();
  });
});
document.addEventListener("click", hideContextMenu);
document.addEventListener("click", (event) => {
  if (els.syncPanel.open && !els.syncPanel.contains(event.target)) {
    els.syncPanel.open = false;
  }
});
els.syncPanel.addEventListener("click", (event) => event.stopPropagation());
window.addEventListener("beforeunload", (event) => {
  if (!hasUnsyncedChanges) return;
  event.preventDefault();
  event.returnValue = "";
});

loadSyncSettings();
updateDirtyStatus();
render();
