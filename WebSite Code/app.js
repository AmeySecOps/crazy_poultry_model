import {
  PATHS,
  auth,
  createRecord,
  deleteRecord,
  initOptionalAuth,
  onAuthStateChanged,
  saveSettings,
  subscribe,
  updateRecord,
} from "./firebase.js";

const DEFAULT_SETTINGS = {
  tempThreshold: 38,
  gasThreshold: 800,
  waterThreshold: 0.5,
  fanTempThreshold: 35,
  darkLdrThreshold: 0.5,
  pumpWaterThreshold: 0.5,
  alarmGasThreshold: 600,
  alertSoundEnabled: true,
};

const money = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

class FarmApp {
  constructor() {
    this.state = {
      settings: { ...DEFAULT_SETTINGS },
      telemetry: null,
      connected: false,
      batches: [],
      feeding: [],
      health: [],
      expenses: [],
      alertKeys: new Set(),
      audioReady: false,
    };
    this.tempHistory = [];
    this.gasHistory = [];
    this.maxPoints = 24;
    this.charts = {};
    this.dom = {};
  }

  async init() {
    this.cacheDom();
    this.bindEvents();
    this.applyTheme(localStorage.getItem("poultry-theme") || "light");
    this.applySettingsToForm();
    this.setDefaultFormValues();
    this.populateBatchSelectors();
    this.initCharts();
    this.startClock();
    this.updateSummaries();
    this.setStatusRibbon("loading", "Connecting to Firebase services", "Waiting for the first payload from /Poultry.");

    window.addEventListener("pointerdown", () => {
      this.state.audioReady = true;
    }, { once: true });

    await initOptionalAuth();
    this.watchAuth();
    this.subscribeData();
    window.setTimeout(() => this.hideLoading(), 1400);
  }

  cacheDom() {
    this.dom.root = document.documentElement;
    this.dom.loading = document.getElementById("loadingScreen");
    this.dom.sidebar = document.getElementById("sidebar");
    this.dom.sidebarBackdrop = document.getElementById("sidebarBackdrop");
    this.dom.toastStack = document.getElementById("toastStack");
    this.dom.screenReaderAlerts = document.getElementById("screenReaderAlerts");
    this.dom.alertList = document.getElementById("liveAlerts");
    this.dom.alertCountBadge = document.getElementById("alertCountBadge");
    this.dom.recordCount = document.getElementById("recordCount");
    this.dom.lastUpdated = document.getElementById("lastUpdated");
    this.dom.currentTime = document.getElementById("currentTime");
    this.dom.statusRibbon = document.getElementById("statusRibbon");
    this.dom.statusHeadline = document.getElementById("statusHeadline");
    this.dom.statusMessage = document.getElementById("statusMessage");
    this.dom.dbConnectionChip = document.getElementById("dbConnectionChip");
    this.dom.authChip = document.getElementById("authChip");
    this.dom.settingsConnectionLabel = document.getElementById("settingsConnectionLabel");
    this.dom.sidebarFarmStatus = document.getElementById("sidebarFarmStatus");
    this.dom.batchTableBody = document.getElementById("batchTableBody");
    this.dom.feedingTableBody = document.getElementById("feedingTableBody");
    this.dom.healthTableBody = document.getElementById("healthTableBody");
    this.dom.expenseTableBody = document.getElementById("expenseTableBody");
    this.dom.batchForm = document.getElementById("batchForm");
    this.dom.feedingForm = document.getElementById("feedingForm");
    this.dom.healthForm = document.getElementById("healthForm");
    this.dom.expenseForm = document.getElementById("expenseForm");
    this.dom.settingsForm = document.getElementById("settingsForm");
    this.dom.feedBatchId = document.getElementById("feedBatchId");
    this.dom.healthBatchId = document.getElementById("healthBatchId");
    this.dom.modals = [...document.querySelectorAll(".modal")];
    this.dom.views = [...document.querySelectorAll(".view")];
    this.dom.navLinks = [...document.querySelectorAll(".nav-link")];
  }

  bindEvents() {
    this.dom.navLinks.forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        this.showView(link.dataset.viewTarget);
        this.closeSidebar();
      });
    });

    document.getElementById("sidebarToggle").addEventListener("click", () => this.openSidebar());
    document.getElementById("sidebarClose").addEventListener("click", () => this.closeSidebar());
    this.dom.sidebarBackdrop.addEventListener("click", () => this.closeSidebar());
    document.getElementById("themeToggle").addEventListener("click", () => this.toggleTheme());
    document.getElementById("themeToggleMobile").addEventListener("click", () => this.toggleTheme());

    document.querySelectorAll("[data-open-modal]").forEach((button) => {
      button.addEventListener("click", () => this.openModal(button.dataset.openModal));
    });

    document.querySelectorAll("[data-close-modal]").forEach((button) => {
      button.addEventListener("click", () => this.closeModals());
    });

    this.dom.modals.forEach((modal) => {
      modal.addEventListener("click", (event) => {
        if (event.target === modal) this.closeModals();
      });
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.closeModals();
    });

    this.dom.batchForm.addEventListener("submit", (event) => this.handleBatchSubmit(event));
    this.dom.feedingForm.addEventListener("submit", (event) => this.handleFeedingSubmit(event));
    this.dom.healthForm.addEventListener("submit", (event) => this.handleHealthSubmit(event));
    this.dom.expenseForm.addEventListener("submit", (event) => this.handleExpenseSubmit(event));
    this.dom.settingsForm.addEventListener("submit", (event) => this.handleSettingsSubmit(event));

    document.addEventListener("click", (event) => this.handleActionClick(event));
  }

  applyTheme(theme) {
    this.dom.root.dataset.theme = theme;
    localStorage.setItem("poultry-theme", theme);
    if (this.charts.temp) this.refreshChartsTheme();
  }

  toggleTheme() {
    const next = this.dom.root.dataset.theme === "dark" ? "light" : "dark";
    this.applyTheme(next);
  }

  openSidebar() {
    document.body.classList.add("sidebar-open");
    this.dom.sidebar.classList.add("is-open");
    this.dom.sidebarBackdrop.classList.add("is-open");
  }

  closeSidebar() {
    document.body.classList.remove("sidebar-open");
    this.dom.sidebar.classList.remove("is-open");
    this.dom.sidebarBackdrop.classList.remove("is-open");
  }

  showView(viewName) {
    this.dom.views.forEach((view) => view.classList.toggle("is-active", view.dataset.view === viewName));
    this.dom.navLinks.forEach((link) => link.classList.toggle("is-active", link.dataset.viewTarget === viewName));
  }

  hideLoading() {
    this.dom.loading.classList.add("is-hidden");
  }

  startClock() {
    const tick = () => {
      this.dom.currentTime.textContent = new Date().toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
      });
    };
    tick();
    window.setInterval(tick, 1000 * 30);
  }

  initCharts() {
    const commonOptions = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: { grid: { color: this.cssVar("--line") }, ticks: { color: this.cssVar("--muted") } },
        y: { grid: { color: this.cssVar("--line") }, ticks: { color: this.cssVar("--muted") } },
      },
      plugins: { legend: { display: false } },
    };

    this.charts.temp = new Chart(document.getElementById("tempChart"), {
      type: "line",
      data: { labels: [], datasets: [{ data: [], borderColor: this.cssVar("--green"), backgroundColor: "rgba(24,122,69,0.14)", fill: true, tension: 0.35 }] },
      options: commonOptions,
    });

    this.charts.gas = new Chart(document.getElementById("gasChart"), {
      type: "line",
      data: { labels: [], datasets: [{ data: [], borderColor: this.cssVar("--amber"), backgroundColor: "rgba(211,140,28,0.14)", fill: true, tension: 0.35 }] },
      options: commonOptions,
    });
  }

  refreshChartsTheme() {
    [this.charts.temp, this.charts.gas].forEach((chart, index) => {
      if (!chart) return;
      chart.options.scales.x.grid.color = this.cssVar("--line");
      chart.options.scales.x.ticks.color = this.cssVar("--muted");
      chart.options.scales.y.grid.color = this.cssVar("--line");
      chart.options.scales.y.ticks.color = this.cssVar("--muted");
      chart.data.datasets[0].borderColor = index === 0 ? this.cssVar("--green") : this.cssVar("--amber");
      chart.update();
    });
  }

  subscribeData() {
    subscribe(PATHS.connected, (value) => this.handleConnection(Boolean(value)), () => this.handleFirebaseError("Realtime Database connection check failed."));
    subscribe(PATHS.settings, (data) => this.handleSettings(data || {}), () => this.handleFirebaseError("Settings listener failed."));
    subscribe(PATHS.poultry, (data) => this.handleTelemetry(data), () => this.handleFirebaseError("Telemetry listener failed."));
    subscribe(PATHS.batches, (data) => {
      this.state.batches = this.mapRecords(data, ["date", "createdAt"]);
      this.renderBatches();
      this.populateBatchSelectors();
      this.updateSummaries();
    }, () => this.handleFirebaseError("Batch listener failed."));
    subscribe(PATHS.feeding, (data) => {
      this.state.feeding = this.mapRecords(data, ["scheduledAt", "createdAt"]);
      this.renderFeeding();
      this.updateSummaries();
    }, () => this.handleFirebaseError("Feeding listener failed."));
    subscribe(PATHS.health, (data) => {
      this.state.health = this.mapRecords(data, ["date", "createdAt"]);
      this.renderHealth();
      this.updateSummaries();
    }, () => this.handleFirebaseError("Health listener failed."));
    subscribe(PATHS.expenses, (data) => {
      this.state.expenses = this.mapRecords(data, ["date", "createdAt"]);
      this.renderExpenses();
      this.updateSummaries();
    }, () => this.handleFirebaseError("Expense listener failed."));
  }

  handleConnection(isConnected) {
    this.state.connected = isConnected;
    this.setChip(this.dom.dbConnectionChip, isConnected ? "Database: Connected" : "Database: Disconnected", isConnected);
    this.dom.settingsConnectionLabel.textContent = isConnected ? "Connected" : "Disconnected";
  }

  watchAuth() {
    onAuthStateChanged(auth, (user) => {
      this.setChip(this.dom.authChip, user ? "Session: Authenticated" : "Session: Guest mode", true);
    });
  }

  handleSettings(data) {
    this.state.settings = { ...DEFAULT_SETTINGS, ...data };
    this.applySettingsToForm();
    if (this.state.telemetry) {
      this.renderTelemetry(this.state.telemetry);
    }
  }

  handleTelemetry(data) {
    this.hideLoading();
    if (!data) {
      this.state.telemetry = null;
      this.setStatusRibbon("warning", "Connected, but waiting for poultry data", "No payload is currently available at /Poultry.");
      this.dom.sidebarFarmStatus.textContent = "Waiting for live telemetry";
      return;
    }

    const telemetry = {
      temperature: this.num(data.Temperature),
      gas: this.num(data.Gas),
      water: this.waterRatio(data.Water),
      ldr: this.num(data.LDR),
      wifi: this.bool(data.WiFi),
      firebase: this.bool(data.Firebase),
      raw: data,
    };

    this.state.telemetry = telemetry;
    this.dom.lastUpdated.textContent = new Date().toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    this.renderTelemetry(telemetry);
    this.updateCharts(telemetry);
    this.updateAlerts(telemetry);
  }

  renderTelemetry(telemetry) {
    const s = this.state.settings;
    const lightOn = telemetry.ldr > s.darkLdrThreshold;
    const gasLevel = telemetry.gas >= s.gasThreshold ? "Danger" : telemetry.gas >= s.alarmGasThreshold ? "Warning" : "Safe";
    const gasSeverity = telemetry.gas >= s.gasThreshold ? "danger" : telemetry.gas >= s.alarmGasThreshold ? "warning" : "normal";
    const tempSeverity = telemetry.temperature >= s.tempThreshold ? "danger" : telemetry.temperature >= s.fanTempThreshold ? "warning" : "normal";
    const waterSeverity = telemetry.water <= s.waterThreshold ? "danger" : telemetry.water <= Math.min(1, s.waterThreshold + 0.1) ? "warning" : "normal";

    this.setMetric("temp", `${telemetry.temperature.toFixed(1)}C`, tempSeverity === "danger" ? "Critical" : tempSeverity === "warning" ? "Watch" : "Normal", `Fan trigger ${s.fanTempThreshold}C`, tempSeverity);
    this.setMetric("light", lightOn ? "Night" : "Day", lightOn ? "Bulb On" : "Bulb Off ", `LDR ${telemetry.ldr}`, lightOn ? "normal" : "warning");
    this.setMetric("gas", gasLevel, gasLevel, `${Math.round(telemetry.gas)} ppm`, gasSeverity);
    this.setMetric("water", telemetry.water <= s.waterThreshold ? "Low" : "OK", telemetry.water <= s.waterThreshold ? "Refill needed" : "Reservoir stable", `${Math.round(telemetry.water * 100)}% level`, waterSeverity);
    this.setMetric("wifi", telemetry.wifi ? "Online" : "Offline", telemetry.wifi ? "Connected" : "Device link lost", "ESP8266 network", telemetry.wifi ? "normal" : "danger");
    this.setMetric("firebase", telemetry.firebase ? "Synced" : "Offline", telemetry.firebase ? "Cloud write OK" : "Cloud write failed", "Device sync flag", telemetry.firebase ? "normal" : "danger");

    this.renderAutomation(telemetry);

    if (!telemetry.wifi || !telemetry.firebase) {
      this.setStatusRibbon("warning", "Device connectivity requires attention", "ESP8266 WiFi or Firebase sync is reporting a fault.");
      this.dom.sidebarFarmStatus.textContent = "Connectivity warning";
    } else if (telemetry.temperature >= s.tempThreshold || telemetry.gas >= s.gasThreshold || telemetry.water <= s.waterThreshold) {
      this.setStatusRibbon("danger", "Critical environmental alerts detected", "Review the alert engine and automation panel immediately.");
      this.dom.sidebarFarmStatus.textContent = "Critical alert";
    } else {
      this.setStatusRibbon("normal", "Smart farm is stable", "Realtime telemetry is flowing and automation logic is within thresholds.");
      this.dom.sidebarFarmStatus.textContent = "Stable and monitored";
    }
  }

  setMetric(key, value, stateText, meta, severity) {
    document.getElementById(`${key}Value`).textContent = value;
    document.getElementById(`${key}Status`).textContent = stateText;
    document.getElementById(`${key}Meta`).textContent = meta;
    document.getElementById(`${key}Status`).className = `metric-state ${severity}`;
    document.getElementById(`${key}Card`).className = `metric-card is-${severity}`;
  }

  renderAutomation(telemetry) {
    const s = this.state.settings;
    this.setAutomation("fan", telemetry.temperature >= s.fanTempThreshold ? "ON" : "OFF", `Temp ${telemetry.temperature.toFixed(1)}C vs ${s.fanTempThreshold}C`, telemetry.temperature >= s.fanTempThreshold, false);
    this.setAutomation("bulb", telemetry.ldr <= s.darkLdrThreshold ? "OFF" : "ON", telemetry.ldr <= s.darkLdrThreshold ? `Ambient light at LDR ${telemetry.ldr}` : `Darkness detected to LDR ${telemetry.ldr}`, telemetry.ldr >= s.darkLdrThreshold, false);
    this.setAutomation("pump", telemetry.water <= s.pumpWaterThreshold ? "ON" : "OFF", `${Math.round(telemetry.water * 100)}% water level`, telemetry.water <= s.pumpWaterThreshold, false);
    this.setAutomation("alarm", telemetry.gas >= s.alarmGasThreshold ? "ACTIVE" : "IDLE", `${Math.round(telemetry.gas)} ppm gas level`, telemetry.gas >= s.alarmGasThreshold, telemetry.gas >= s.gasThreshold);
  }

  setAutomation(key, label, reason, isOn, isAlert) {
    document.getElementById(`${key}Status`).textContent = label;
    document.getElementById(`${key}Reason`).textContent = reason;
    const card = document.getElementById(`${key}Automation`);
    card.className = `automation-card${isOn ? " is-on" : ""}${isAlert ? " is-alert" : ""}`;
  }

  updateAlerts(telemetry) {
    const s = this.state.settings;
    const alerts = [];
    if (telemetry.temperature > s.tempThreshold) alerts.push({ key: "temp", type: "danger", text: `High temperature detected at ${telemetry.temperature.toFixed(1)}C.` });
    if (telemetry.gas > s.gasThreshold) alerts.push({ key: "gas", type: "danger", text: `Gas level is unsafe at ${Math.round(telemetry.gas)} ppm.` });
    if (telemetry.water <= s.waterThreshold) alerts.push({ key: "water", type: "warning", text: `Water level is low at ${Math.round(telemetry.water * 100)}%.` });
    if (!telemetry.wifi) alerts.push({ key: "wifi", type: "warning", text: "ESP8266 WiFi link is offline." });
    if (!telemetry.firebase) alerts.push({ key: "firebase", type: "warning", text: "Device reports Firebase sync failure." });

    const newKeys = new Set(alerts.map((alert) => alert.key));
    const hasNewCritical = [...newKeys].some((key) => !this.state.alertKeys.has(key));
    this.state.alertKeys = newKeys;
    this.dom.alertCountBadge.textContent = `${alerts.length} Active`;

    if (!alerts.length) {
      this.dom.alertList.innerHTML = '<div class="empty-panel"><i class="fa-solid fa-shield-heart"></i><p>Live alerts will appear here when thresholds are crossed.</p></div>';
      return;
    }

    if (hasNewCritical) this.playAlertTone();
    this.dom.screenReaderAlerts.textContent = alerts.map((alert) => alert.text).join(" ");
    this.dom.alertList.innerHTML = alerts.map((alert) => `
      <article class="alert-item ${alert.type}">
        <i class="fa-solid ${alert.type === "danger" ? "fa-triangle-exclamation" : "fa-circle-exclamation"}"></i>
        <div><strong>${this.escapeHtml(alert.type.toUpperCase())}</strong><p>${this.escapeHtml(alert.text)}</p></div>
      </article>
    `).join("");
  }

  playAlertTone() {
    if (!this.state.audioReady || !this.state.settings.alertSoundEnabled) return;
    try {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) return;
      const context = new AudioContextCtor();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sawtooth";
      oscillator.frequency.value = 760;
      gain.gain.value = 0.0001;
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.25);
      oscillator.stop(context.currentTime + 0.27);
    } catch (error) {
      console.warn("Alert sound unavailable", error);
    }
  }

  updateCharts(telemetry) {
    const label = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    this.pushHistory(this.tempHistory, { label, value: Number(telemetry.temperature.toFixed(1)) });
    this.pushHistory(this.gasHistory, { label, value: Math.round(telemetry.gas) });
    this.charts.temp.data.labels = this.tempHistory.map((item) => item.label);
    this.charts.temp.data.datasets[0].data = this.tempHistory.map((item) => item.value);
    this.charts.gas.data.labels = this.gasHistory.map((item) => item.label);
    this.charts.gas.data.datasets[0].data = this.gasHistory.map((item) => item.value);
    this.charts.temp.update();
    this.charts.gas.update();
  }

  pushHistory(history, point) {
    history.push(point);
    if (history.length > this.maxPoints) history.shift();
  }

  renderBatches() {
    const rows = this.state.batches.map((batch) => {
      const age = this.daysOld(batch.date);
      const stage = age < 14 ? ["Brooding", "amber"] : age < 35 ? ["Growing", "green"] : ["Finisher", "blue"];
      return `<tr><td>${this.escapeHtml(batch.batchId || "-")}</td><td>${this.formatDate(batch.date)}</td><td>${this.num(batch.chicks)}</td><td>${age} days</td><td><span class="table-tag ${stage[1]}">${stage[0]}</span></td><td class="note-cell">${this.escapeHtml(batch.notes || "-")}</td><td><div class="table-actions"><button class="action-btn" data-action="edit-batch" data-id="${batch.id}"><i class="fa-solid fa-pen"></i></button><button class="action-btn delete" data-action="delete-batch" data-id="${batch.id}"><i class="fa-solid fa-trash"></i></button></div></td></tr>`;
    }).join("");
    this.dom.batchTableBody.innerHTML = rows || this.emptyRow(7, "fa-egg", "No batch records yet.");
    document.getElementById("batchCountStat").textContent = String(this.state.batches.length);
    document.getElementById("birdCountStat").textContent = String(this.state.batches.reduce((sum, batch) => sum + this.num(batch.chicks), 0));
    document.getElementById("batchAgeStat").textContent = this.state.batches.length ? `${Math.round(this.state.batches.reduce((sum, batch) => sum + this.daysOld(batch.date), 0) / this.state.batches.length)} days` : "0 days";
  }

  renderFeeding() {
    const rows = this.state.feeding.map((item) => `<tr><td>${this.formatDateTime(item.scheduledAt)}</td><td>${this.escapeHtml(item.batchId || "-")}</td><td><span class="table-tag green">${this.escapeHtml(item.feedType || "-")}</span></td><td>${this.num(item.quantityKg).toFixed(1)} kg</td><td class="note-cell">${this.escapeHtml(item.notes || "-")}</td><td><div class="table-actions"><button class="action-btn" data-action="edit-feeding" data-id="${item.id}"><i class="fa-solid fa-pen"></i></button><button class="action-btn delete" data-action="delete-feeding" data-id="${item.id}"><i class="fa-solid fa-trash"></i></button></div></td></tr>`).join("");
    this.dom.feedingTableBody.innerHTML = rows || this.emptyRow(6, "fa-bowl-food", "No feeding schedules or logs yet.");
    const today = this.today();
    const todayFeed = this.state.feeding.filter((item) => (item.scheduledAt || "").slice(0, 10) === today).reduce((sum, item) => sum + this.num(item.quantityKg), 0);
    document.getElementById("feedTodayStat").textContent = `${todayFeed.toFixed(1)} kg`;
    document.getElementById("feedScheduleStat").textContent = String(this.state.feeding.length);
    document.getElementById("feedTypeStat").textContent = this.state.feeding[0]?.feedType || "--";
  }

  renderHealth() {
    const rows = this.state.health.map((item) => {
      const color = item.recordType === "Mortality" ? "red" : item.recordType === "Disease" ? "amber" : "green";
      return `<tr><td>${this.formatDate(item.date)}</td><td>${this.escapeHtml(item.batchId || "-")}</td><td><span class="table-tag ${color}">${this.escapeHtml(item.recordType || "-")}</span></td><td>${this.escapeHtml(item.title || "-")}</td><td>${this.num(item.affectedCount)}</td><td>${this.formatDate(item.nextDueDate)}</td><td><div class="table-actions"><button class="action-btn" data-action="edit-health" data-id="${item.id}"><i class="fa-solid fa-pen"></i></button><button class="action-btn delete" data-action="delete-health" data-id="${item.id}"><i class="fa-solid fa-trash"></i></button></div></td></tr>`;
    }).join("");
    this.dom.healthTableBody.innerHTML = rows || this.emptyRow(7, "fa-heart-pulse", "No health records yet.");
    document.getElementById("vaccinationStat").textContent = String(this.state.health.filter((item) => item.recordType === "Vaccination").length);
    document.getElementById("mortalityStat").textContent = String(this.state.health.filter((item) => item.recordType === "Mortality").reduce((sum, item) => sum + this.num(item.affectedCount), 0));
    const nextDue = this.state.health.filter((item) => item.nextDueDate).map((item) => item.nextDueDate).sort()[0];
    document.getElementById("nextDueStat").textContent = nextDue ? this.formatDate(nextDue) : "--";
  }

  renderExpenses() {
    const rows = this.state.expenses.map((item) => {
      const color = item.entryType === "Income" ? "green" : "amber";
      return `<tr><td>${this.formatDate(item.date)}</td><td><span class="table-tag ${color}">${this.escapeHtml(item.entryType || "-")}</span></td><td>${this.escapeHtml(item.category || "-")}</td><td>${this.formatCurrency(item.amount)}</td><td>${this.escapeHtml(item.reference || "-")}</td><td class="note-cell">${this.escapeHtml(item.notes || "-")}</td><td><div class="table-actions"><button class="action-btn" data-action="edit-expense" data-id="${item.id}"><i class="fa-solid fa-pen"></i></button><button class="action-btn delete" data-action="delete-expense" data-id="${item.id}"><i class="fa-solid fa-trash"></i></button></div></td></tr>`;
    }).join("");
    this.dom.expenseTableBody.innerHTML = rows || this.emptyRow(7, "fa-wallet", "No transactions recorded yet.");
    const expense = this.state.expenses.filter((item) => item.entryType === "Expense").reduce((sum, item) => sum + this.num(item.amount), 0);
    const income = this.state.expenses.filter((item) => item.entryType === "Income").reduce((sum, item) => sum + this.num(item.amount), 0);
    const profit = income - expense;
    document.getElementById("totalExpenseValue").textContent = this.formatCurrency(expense);
    document.getElementById("totalIncomeValue").textContent = this.formatCurrency(income);
    document.getElementById("profitValue").textContent = this.formatCurrency(profit);
    document.getElementById("profitCard").className = `finance-card ${profit >= 0 ? "is-profit" : "is-loss"}`;
  }

  updateSummaries() {
    const birds = this.state.batches.reduce((sum, batch) => sum + this.num(batch.chicks), 0);
    const feedToday = this.state.feeding.filter((item) => (item.scheduledAt || "").slice(0, 10) === this.today()).reduce((sum, item) => sum + this.num(item.quantityKg), 0);
    const expense = this.state.expenses.filter((item) => item.entryType === "Expense").reduce((sum, item) => sum + this.num(item.amount), 0);
    const income = this.state.expenses.filter((item) => item.entryType === "Income").reduce((sum, item) => sum + this.num(item.amount), 0);
    document.getElementById("summaryBatches").textContent = String(this.state.batches.length);
    document.getElementById("summaryBirds").textContent = String(birds);
    document.getElementById("summaryFeedToday").textContent = `${feedToday.toFixed(1)} kg`;
    document.getElementById("summaryProfit").textContent = this.formatCurrency(income - expense);
    this.dom.recordCount.textContent = String(this.state.batches.length + this.state.feeding.length + this.state.health.length + this.state.expenses.length);
  }

  populateBatchSelectors() {
    const options = this.state.batches.length ? this.state.batches.map((batch) => `<option value="${this.escapeAttr(batch.batchId)}">${this.escapeHtml(batch.batchId)}</option>`).join("") : '<option value="General">General</option>';
    this.dom.feedBatchId.innerHTML = options;
    this.dom.healthBatchId.innerHTML = options;
  }

  setDefaultFormValues() {
    document.getElementById("batchDate").value = this.today();
    document.getElementById("batchCount").value = 100;
    document.getElementById("feedDateTime").value = this.nowLocal();
    document.getElementById("healthDate").value = this.today();
    document.getElementById("expenseDate").value = this.today();
  }

  applySettingsToForm() {
    Object.entries(this.state.settings).forEach(([key, value]) => {
      const field = document.getElementById(key);
      if (!field) return;
      if (field.type === "checkbox") field.checked = Boolean(value);
      else field.value = value;
    });
  }

  openModal(id, record) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    if (!record) return;
    if (id === "batchModal") {
      document.getElementById("batchModalTitle").textContent = "Edit Batch";
      document.getElementById("batchRecordId").value = record.id;
      document.getElementById("batchId").value = record.batchId || "";
      document.getElementById("batchDate").value = record.date || this.today();
      document.getElementById("batchCount").value = this.num(record.chicks);
      document.getElementById("batchNotes").value = record.notes || "";
    }
    if (id === "feedingModal") {
      document.getElementById("feedingModalTitle").textContent = "Edit Feed Log";
      document.getElementById("feedingRecordId").value = record.id;
      document.getElementById("feedBatchId").value = record.batchId || this.dom.feedBatchId.value;
      document.getElementById("feedDateTime").value = (record.scheduledAt || this.nowLocal()).slice(0, 16);
      document.getElementById("feedType").value = record.feedType || "Starter";
      document.getElementById("feedQuantity").value = this.num(record.quantityKg);
      document.getElementById("feedNotes").value = record.notes || "";
    }
    if (id === "healthModal") {
      document.getElementById("healthModalTitle").textContent = "Edit Health Record";
      document.getElementById("healthRecordId").value = record.id;
      document.getElementById("healthBatchId").value = record.batchId || this.dom.healthBatchId.value;
      document.getElementById("healthType").value = record.recordType || "Vaccination";
      document.getElementById("healthTitleInput").value = record.title || "";
      document.getElementById("healthDate").value = record.date || this.today();
      document.getElementById("healthAffected").value = this.num(record.affectedCount);
      document.getElementById("healthNextDue").value = record.nextDueDate || "";
      document.getElementById("healthNotes").value = record.notes || "";
    }
    if (id === "expenseModal") {
      document.getElementById("expenseModalTitle").textContent = "Edit Transaction";
      document.getElementById("expenseRecordId").value = record.id;
      document.getElementById("expenseType").value = record.entryType || "Expense";
      document.getElementById("expenseCategory").value = record.category || "Feed";
      document.getElementById("expenseDate").value = record.date || this.today();
      document.getElementById("expenseAmount").value = this.num(record.amount);
      document.getElementById("expenseReference").value = record.reference || "";
      document.getElementById("expenseNotes").value = record.notes || "";
    }
  }

  closeModals() {
    this.dom.modals.forEach((modal) => { modal.classList.remove("is-open"); modal.setAttribute("aria-hidden", "true"); });
    this.dom.batchForm.reset(); this.dom.feedingForm.reset(); this.dom.healthForm.reset(); this.dom.expenseForm.reset();
    document.getElementById("batchModalTitle").textContent = "Add New Batch";
    document.getElementById("feedingModalTitle").textContent = "Add Feeding Schedule";
    document.getElementById("healthModalTitle").textContent = "Add Health Entry";
    document.getElementById("expenseModalTitle").textContent = "Add Transaction";
    this.setDefaultFormValues();
    this.populateBatchSelectors();
  }

  async handleBatchSubmit(event) {
    event.preventDefault();
    const payload = { batchId: document.getElementById("batchId").value.trim(), date: document.getElementById("batchDate").value, chicks: this.num(document.getElementById("batchCount").value), notes: document.getElementById("batchNotes").value.trim() };
    if (!payload.batchId || !payload.date || payload.chicks <= 0) return this.showToast("Enter a valid batch record.", "error");
    const id = document.getElementById("batchRecordId").value;
    await this.persistRecord(PATHS.batches, id, payload, `${id ? "Batch updated" : "Batch saved"}.`);
  }
  async handleFeedingSubmit(event) {
    event.preventDefault();
    const payload = { batchId: this.dom.feedBatchId.value, scheduledAt: document.getElementById("feedDateTime").value, feedType: document.getElementById("feedType").value, quantityKg: this.num(document.getElementById("feedQuantity").value), notes: document.getElementById("feedNotes").value.trim() };
    if (!payload.scheduledAt || payload.quantityKg <= 0) return this.showToast("Enter a valid feed schedule.", "error");
    const id = document.getElementById("feedingRecordId").value;
    await this.persistRecord(PATHS.feeding, id, payload, `${id ? "Feed log updated" : "Feed log saved"}.`);
  }
  async handleHealthSubmit(event) {
    event.preventDefault();
    const payload = { batchId: this.dom.healthBatchId.value, recordType: document.getElementById("healthType").value, title: document.getElementById("healthTitleInput").value.trim(), date: document.getElementById("healthDate").value, affectedCount: this.num(document.getElementById("healthAffected").value), nextDueDate: document.getElementById("healthNextDue").value, notes: document.getElementById("healthNotes").value.trim() };
    if (!payload.title || !payload.date || payload.affectedCount < 0) return this.showToast("Enter a valid health record.", "error");
    const id = document.getElementById("healthRecordId").value;
    await this.persistRecord(PATHS.health, id, payload, `${id ? "Health record updated" : "Health record saved"}.`);
  }
  async handleExpenseSubmit(event) {
    event.preventDefault();
    const payload = { entryType: document.getElementById("expenseType").value, category: document.getElementById("expenseCategory").value, date: document.getElementById("expenseDate").value, amount: this.num(document.getElementById("expenseAmount").value), reference: document.getElementById("expenseReference").value.trim(), notes: document.getElementById("expenseNotes").value.trim() };
    if (!payload.date || payload.amount <= 0) return this.showToast("Enter a valid transaction.", "error");
    const id = document.getElementById("expenseRecordId").value;
    await this.persistRecord(PATHS.expenses, id, payload, `${id ? "Transaction updated" : "Transaction saved"}.`);
  }
  async handleSettingsSubmit(event) {
    event.preventDefault();
    const payload = { tempThreshold: this.num(document.getElementById("tempThreshold").value), gasThreshold: this.num(document.getElementById("gasThreshold").value), waterThreshold: this.num(document.getElementById("waterThreshold").value), fanTempThreshold: this.num(document.getElementById("fanTempThreshold").value), darkLdrThreshold: this.num(document.getElementById("darkLdrThreshold").value), pumpWaterThreshold: this.num(document.getElementById("pumpWaterThreshold").value), alarmGasThreshold: this.num(document.getElementById("alarmGasThreshold").value), alertSoundEnabled: document.getElementById("alertSoundEnabled").checked };
    try { await saveSettings(payload); this.showToast("Settings saved to Firebase.", "success"); } catch (error) { this.handleFirebaseError("Unable to save settings.", error); }
  }

  async persistRecord(path, id, payload, successText) {
    try {
      if (id) await updateRecord(path, id, payload);
      else await createRecord(path, payload);
      this.closeModals();
      this.showToast(successText, "success");
    } catch (error) {
      this.handleFirebaseError("Unable to write to Firebase.", error);
    }
  }

  async handleActionClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const { action, id } = button.dataset;
    const lookups = {
      "edit-batch": [this.state.batches, "batchModal"],
      "edit-feeding": [this.state.feeding, "feedingModal"],
      "edit-health": [this.state.health, "healthModal"],
      "edit-expense": [this.state.expenses, "expenseModal"],
    };
    if (lookups[action]) {
      const [collection, modalId] = lookups[action];
      this.openModal(modalId, collection.find((item) => item.id === id));
      return;
    }
    const deletes = {
      "delete-batch": PATHS.batches,
      "delete-feeding": PATHS.feeding,
      "delete-health": PATHS.health,
      "delete-expense": PATHS.expenses,
    };
    if (deletes[action] && window.confirm("Delete this record? This action cannot be undone.")) {
      try { await deleteRecord(deletes[action], id); this.showToast("Record deleted.", "success"); }
      catch (error) { this.handleFirebaseError("Unable to delete record.", error); }
    }
  }

  mapRecords(data, sortKeys) {
    return Object.entries(data || {})
      .map(([id, value]) => ({ id, ...value }))
      .sort((a, b) => {
        const aValue = sortKeys.map((key) => a[key]).find(Boolean) || "";
        const bValue = sortKeys.map((key) => b[key]).find(Boolean) || "";
        return String(bValue).localeCompare(String(aValue));
      });
  }

  setChip(node, text, isOnline) {
    node.className = `status-chip ${isOnline ? "is-online" : "is-offline"}`;
    node.querySelector("span:last-child").textContent = text;
  }

  setStatusRibbon(type, headline, message) {
    this.dom.statusRibbon.className = `status-ribbon status-ribbon--${type}`;
    this.dom.statusHeadline.textContent = headline;
    this.dom.statusMessage.textContent = message;
  }

  showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast is-${type}`;
    toast.textContent = message;
    this.dom.toastStack.appendChild(toast);
    window.setTimeout(() => toast.remove(), 3200);
  }

  handleFirebaseError(message, error) {
    console.error(message, error || "");
    this.setStatusRibbon("danger", "Firebase connection problem", message);
    this.showToast(message, "error");
  }

  emptyRow(columns, icon, text) {
    return `<tr><td colspan="${columns}"><div class="table-empty"><i class="fa-solid ${icon}"></i><p>${this.escapeHtml(text)}</p></div></td></tr>`;
  }

  formatCurrency(value) { return `Rs ${money.format(this.num(value))}`; }
  formatDate(value) { return value ? new Date(value).toLocaleDateString() : "-"; }
  formatDateTime(value) { return value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "-"; }
  daysOld(value) { return value ? Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86400000)) : 0; }
  num(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
  bool(value) { return value === true || value === 1 || value === "1" || value === "true"; }
  waterRatio(value) { const parsed = this.num(value); return parsed > 1 ? Math.min(parsed / 100, 1) : Math.max(parsed, 0); }
  today() { return new Date().toISOString().slice(0, 10); }
  nowLocal() { return new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
  cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
  escapeAttr(value) { return this.escapeHtml(value); }
}

const app = new FarmApp();
app.init();
window.app = app;
