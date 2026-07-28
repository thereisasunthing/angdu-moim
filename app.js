/* ============================================
   앵두모임 - app.js
   화면 렌더링 및 이벤트 처리를 담당합니다.
   (storage.js의 데이터 함수를 사용하며, 화면 자체는 여기서만 다룹니다)
   ============================================ */

/* 화면이 보여질 때마다 다시 그려야 하는 화면들을 등록합니다.
   (예: 납부관리 화면은 다른 달로 이동했다가 돌아와도 항상 최신 데이터를 보여줘야 함) */
const screenRenderers = {
  "screen-payment": function () { renderPaymentScreen(); },
  "screen-ledger": function () { renderLedgerScreen(); },
  "screen-summary": function () { renderSummaryScreen(); }
};

/**
 * 지정한 id를 가진 화면(section)만 보이게 하고 나머지는 숨깁니다.
 * @param {string} screenId - 보여줄 화면의 id (예: "screen-home")
 */
function showScreen(screenId) {
  const allScreens = document.querySelectorAll(".screen");
  allScreens.forEach(function (screen) {
    if (screen.id === screenId) {
      screen.classList.add("active");
    } else {
      screen.classList.remove("active");
    }
  });
  // 화면이 바뀌면 항상 맨 위로 스크롤 (어르신이 스크롤 위치 때문에 헷갈리지 않도록)
  window.scrollTo(0, 0);

  if (screenRenderers[screenId]) {
    screenRenderers[screenId]();
  }
}

/**
 * data-target 속성을 가진 모든 버튼에 화면 전환 이벤트를 연결합니다.
 * (홈 화면의 메뉴 버튼, 각 화면의 "← 홈으로" 버튼 모두 공통 처리)
 */
function initNavigation() {
  const navButtons = document.querySelectorAll("[data-target]");
  navButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      const targetScreenId = button.getAttribute("data-target");
      showScreen(targetScreenId);
    });
  });
}

/**
 * 앱 시작 시 실행되는 초기화 함수
 */
function initApp() {
  initStorage();       // 회원 15명 / 설정값 최초 1회 세팅 (storage.js)
  initNavigation();
  initPaymentScreen(); // 납부관리 화면의 버튼 이벤트 연결 (최초 1회만)
  initLedgerScreen();  // 장부 화면의 버튼 이벤트 연결 (최초 1회만)
  initSummaryScreen(); // 결산 화면의 버튼 이벤트 연결 (최초 1회만)
  initBackupScreen();  // 백업 화면의 버튼 이벤트 연결 (최초 1회만)
  showScreen("screen-home");
}

document.addEventListener("DOMContentLoaded", initApp);

/**
 * 서비스 워커를 등록합니다. (오프라인 사용 + 홈화면 설치 지원)
 * 서비스 워커를 지원하지 않는 아주 오래된 브라우저에서도 앱 자체는 정상 동작해야 하므로
 * 지원 여부를 먼저 확인합니다.
 */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("service-worker.js").catch(function (error) {
      console.error("[app] 서비스 워커 등록 실패:", error);
    });
  });
}

/* ============================================
   납부관리 화면
   ============================================ */

/* 상태 버튼 4종의 표시 정보 (순서 = 화면에 보이는 순서) */
const PAYMENT_STATUS_DEFS = [
  { key: "paid", symbol: "○", label: "납부", className: "status-paid" },
  { key: "partial", symbol: "△", label: "일부", className: "status-partial" },
  { key: "unpaid", symbol: "×", label: "미납", className: "status-unpaid" },
  { key: "unknown", symbol: "?", label: "미확인", className: "status-unknown" }
];

/* 운영기간(2026-07 ~ 2027-06)의 월 목록과 현재 보고 있는 달의 위치.
   화면을 열 때 한 번만 계산해서 재사용합니다. */
let paymentMonthList = null;
let currentMonthIndex = null;

/* 일부납부 금액 입력 모달이 어떤 회원을 위한 것인지 기억해두는 변수 */
let partialModalMemberId = null;

/* 납부관리 화면의 회원 이름 검색어 (없으면 전체 표시) */
let paymentSearchTerm = "";

/**
 * 설정값(startMonth ~ endMonth)을 바탕으로 "2026-07" 형태의 월 목록을 만듭니다.
 */
function getMonthList() {
  const settings = getSettings();
  const list = [];

  const startParts = settings.startMonth.split("-").map(Number);
  const endParts = settings.endMonth.split("-").map(Number);
  let year = startParts[0];
  let month = startParts[1];
  const endYear = endParts[0];
  const endMonth = endParts[1];

  while (year < endYear || (year === endYear && month <= endMonth)) {
    list.push(year + "-" + String(month).padStart(2, "0"));
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return list;
}

/**
 * 오늘 날짜에 해당하는 달이 목록에 있으면 그 위치를, 없으면 0번(첫 달)을 반환합니다.
 */
function getDefaultMonthIndex(monthList) {
  const now = new Date();
  const key = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  const index = monthList.indexOf(key);
  return index === -1 ? 0 : index;
}

/**
 * "2026-07" -> "2026년 7월" 형태로 변환합니다.
 */
function formatMonthLabel(monthKey) {
  const parts = monthKey.split("-");
  return parts[0] + "년 " + Number(parts[1]) + "월";
}

/**
 * 납부관리 화면의 월 목록/현재 위치가 아직 계산되지 않았으면 최초 1회 계산합니다.
 */
function ensurePaymentMonthState() {
  if (paymentMonthList === null) {
    paymentMonthList = getMonthList();
    currentMonthIndex = getDefaultMonthIndex(paymentMonthList);
  }
}

/**
 * 회원 한 명의 상태 버튼 4개를 담은 요소를 만듭니다.
 */
function buildStatusButtons(member, currentStatus) {
  const group = document.createElement("div");
  group.className = "status-buttons";

  PAYMENT_STATUS_DEFS.forEach(function (def) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "status-btn " + def.className + (currentStatus === def.key ? " active" : "");
    btn.dataset.status = def.key;
    btn.dataset.memberId = String(member.id);
    btn.textContent = def.symbol + " " + def.label;
    group.appendChild(btn);
  });

  return group;
}

/**
 * 납부관리 화면 전체(월 라벨, 회원 목록, 납부율)를 현재 상태에 맞게 다시 그립니다.
 */
function renderPaymentScreen() {
  ensurePaymentMonthState();

  const monthKey = paymentMonthList[currentMonthIndex];

  document.getElementById("current-month-label").textContent = formatMonthLabel(monthKey);
  document.getElementById("btn-prev-month").disabled = currentMonthIndex === 0;
  document.getElementById("btn-next-month").disabled = currentMonthIndex === paymentMonthList.length - 1;

  const allMembers = getMembers();
  const monthPayments = getPaymentsForMonth(monthKey);

  const listEl = document.getElementById("member-list");
  listEl.innerHTML = "";

  // 검색어가 있으면 이름에 검색어가 포함된 회원만 골라냅니다.
  const visibleMembers = paymentSearchTerm
    ? allMembers.filter(function (member) {
        return member.name.indexOf(paymentSearchTerm) !== -1;
      })
    : allMembers;

  if (visibleMembers.length === 0) {
    const empty = document.createElement("p");
    empty.className = "placeholder-text";
    empty.textContent = "검색된 회원이 없습니다.";
    listEl.appendChild(empty);
  } else {
    visibleMembers.forEach(function (member) {
      const status = monthPayments[member.id].status;

      const li = document.createElement("li");
      li.className = "member-card";
      li.dataset.memberId = String(member.id);

      const nameDiv = document.createElement("div");
      nameDiv.className = "member-name";
      nameDiv.textContent = member.name;

      li.appendChild(nameDiv);
      li.appendChild(buildStatusButtons(member, status));
      listEl.appendChild(li);
    });
  }

  // 납부율은 검색 결과와 상관없이 항상 전체 회원 기준으로 계산합니다.
  const rate = getMonthlyPaymentRate(monthKey);
  const collected = getMonthlyCollectedAmount(monthKey);
  const target = getMonthlyTargetAmount();
  document.getElementById("payment-rate-text").textContent =
    "이번달 납부율 " + rate + "% (" + formatMoney(collected) + " / " + formatMoney(target) + ")";
}

/**
 * "이전 달" 버튼 처리
 */
function goToPrevMonth() {
  ensurePaymentMonthState();
  if (currentMonthIndex > 0) {
    currentMonthIndex -= 1;
    renderPaymentScreen();
  }
}

/**
 * "다음 달" 버튼 처리
 */
function goToNextMonth() {
  ensurePaymentMonthState();
  if (currentMonthIndex < paymentMonthList.length - 1) {
    currentMonthIndex += 1;
    renderPaymentScreen();
  }
}

/**
 * 회원 목록 안에서 상태 버튼을 눌렀을 때의 공통 처리 (이벤트 위임 방식).
 * "일부납부"는 금액을 입력받아야 하므로 모달을 띄우고,
 * 나머지(납부/미납/미확인)는 누르는 즉시 저장합니다.
 */
function handleMemberListClick(event) {
  const btn = event.target.closest(".status-btn");
  if (!btn) {
    return;
  }

  const memberId = Number(btn.dataset.memberId);
  const status = btn.dataset.status;

  if (status === "partial") {
    openPartialModal(memberId);
    return;
  }

  const monthKey = paymentMonthList[currentMonthIndex];
  const settings = getSettings();
  const amount = status === "paid" ? settings.monthlyFee : 0;

  savePayment(monthKey, memberId, status, amount);
  renderPaymentScreen();
}

/**
 * 일부납부 금액 입력 모달을 엽니다.
 */
function openPartialModal(memberId) {
  const member = getMembers().find(function (m) {
    return m.id === memberId;
  });
  if (!member) {
    console.error("[payment] 회원을 찾지 못함:", memberId);
    return;
  }

  const monthKey = paymentMonthList[currentMonthIndex];
  const existing = getPaymentsForMonth(monthKey)[memberId];

  partialModalMemberId = memberId;
  document.getElementById("partial-modal-name").textContent = member.name;

  const input = document.getElementById("partial-amount-input");
  input.value = existing.status === "partial" ? existing.amount : "";

  document.getElementById("partial-modal").classList.remove("hidden");
  input.focus();
}

/**
 * 일부납부 금액 입력 모달을 닫습니다.
 */
function closePartialModal() {
  document.getElementById("partial-modal").classList.add("hidden");
  partialModalMemberId = null;
}

/**
 * 모달의 "확인" 버튼 처리. 입력값을 검증하고 저장합니다.
 */
function confirmPartialAmount() {
  const input = document.getElementById("partial-amount-input");
  const rawValue = input.value.trim();
  const amount = Number(rawValue);

  if (rawValue === "" || isNaN(amount) || amount < 0) {
    alert("올바른 금액을 숫자로 입력해주세요.");
    return;
  }

  const monthKey = paymentMonthList[currentMonthIndex];
  savePayment(monthKey, partialModalMemberId, "partial", amount);

  closePartialModal();
  renderPaymentScreen();
}

/**
 * 납부관리 화면의 모든 버튼에 이벤트를 연결합니다. (앱 시작 시 한 번만 호출)
 */
function initPaymentScreen() {
  document.getElementById("btn-prev-month").addEventListener("click", goToPrevMonth);
  document.getElementById("btn-next-month").addEventListener("click", goToNextMonth);
  document.getElementById("member-list").addEventListener("click", handleMemberListClick);
  document.getElementById("partial-cancel-btn").addEventListener("click", closePartialModal);
  document.getElementById("partial-confirm-btn").addEventListener("click", confirmPartialAmount);

  const searchInput = document.getElementById("member-search-input");
  searchInput.addEventListener("input", function () {
    paymentSearchTerm = searchInput.value.trim();
    renderPaymentScreen();
  });

  document.getElementById("member-search-clear-btn").addEventListener("click", function () {
    paymentSearchTerm = "";
    searchInput.value = "";
    renderPaymentScreen();
    searchInput.focus();
  });
}

/* ============================================
   장부 화면
   ============================================ */

/* 현재 폼이 "새 항목 추가" 모드인지 "기존 항목 수정" 모드인지 저장.
   null이면 추가 모드, 값이 있으면 그 id를 가진 항목을 수정 중인 상태 */
let ledgerEditingId = null;

/* 현재 폼에서 선택된 입금/출금 구분 */
let ledgerSelectedType = "income";

/**
 * 숫자를 "120,000원" 형태로 표시합니다.
 */
function formatMoney(amount) {
  return amount.toLocaleString("ko-KR") + "원";
}

/**
 * "2026-07-05" -> "07/05" 형태로 표시합니다. (목록에서 짧게 보이도록)
 */
function formatShortDate(dateStr) {
  const parts = dateStr.split("-");
  return parts[1] + "/" + parts[2];
}

/**
 * 입금/출금 토글 버튼의 선택 상태를 화면에 반영합니다.
 */
function updateTypeToggleUI() {
  document.getElementById("type-income-btn").classList.toggle("active", ledgerSelectedType === "income");
  document.getElementById("type-expense-btn").classList.toggle("active", ledgerSelectedType === "expense");
}

/**
 * 장부 입력 폼을 빈 값(오늘 날짜, 입금 선택)으로 되돌립니다. (추가 모드로 복귀)
 */
function resetLedgerForm() {
  ledgerEditingId = null;
  ledgerSelectedType = "income";
  updateTypeToggleUI();

  const today = new Date();
  const todayStr = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");

  document.getElementById("ledger-date-input").value = todayStr;
  document.getElementById("ledger-content-input").value = "";
  document.getElementById("ledger-amount-input").value = "";
  document.getElementById("ledger-memo-input").value = "";

  document.getElementById("ledger-save-btn").textContent = "저장";
  document.getElementById("ledger-cancel-edit-btn").classList.add("hidden");
}

/**
 * 장부 항목 하나를 목록에 표시할 <li> 요소를 만듭니다.
 * runningBalance: 이 항목까지 반영된 시점의 잔액
 */
function buildLedgerListItem(entry, runningBalance) {
  const li = document.createElement("li");
  li.className = "ledger-item";
  li.dataset.id = entry.id;

  const top = document.createElement("div");
  top.className = "ledger-item-top";

  const dateSpan = document.createElement("span");
  dateSpan.className = "ledger-date";
  dateSpan.textContent = formatShortDate(entry.date);

  const contentSpan = document.createElement("span");
  contentSpan.className = "ledger-content-text";
  contentSpan.textContent = entry.content;

  const amountSpan = document.createElement("span");
  amountSpan.className = "ledger-amount " + (entry.type === "income" ? "income" : "expense");
  amountSpan.textContent = (entry.type === "income" ? "+" : "-") + formatMoney(entry.amount);

  top.appendChild(dateSpan);
  top.appendChild(contentSpan);
  top.appendChild(amountSpan);

  const bottom = document.createElement("div");
  bottom.className = "ledger-item-bottom";

  const memoSpan = document.createElement("span");
  memoSpan.className = "ledger-memo-text";
  memoSpan.textContent = entry.memo ? entry.memo : "";

  const balanceSpan = document.createElement("span");
  balanceSpan.className = "ledger-balance-after";
  balanceSpan.textContent = "잔액 " + formatMoney(runningBalance);

  const actions = document.createElement("div");
  actions.className = "ledger-item-actions";

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "ledger-edit-btn";
  editBtn.dataset.id = entry.id;
  editBtn.textContent = "수정";

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "ledger-delete-btn";
  deleteBtn.dataset.id = entry.id;
  deleteBtn.textContent = "삭제";

  actions.appendChild(editBtn);
  actions.appendChild(deleteBtn);

  bottom.appendChild(memoSpan);
  bottom.appendChild(balanceSpan);
  bottom.appendChild(actions);

  li.appendChild(top);
  li.appendChild(bottom);

  return li;
}

/**
 * 장부 화면 전체(목록, 잔액)를 다시 그립니다.
 */
function renderLedgerScreen() {
  const list = getLedger(); // storage.js에서 최신순으로 정렬되어 옴

  // 각 줄의 "그 시점까지의 잔액"을 계산하려면 날짜 오래된 순으로 누적 계산이 필요함
  const chronological = list.slice().reverse();
  let running = 0;
  const balanceMap = {};
  chronological.forEach(function (entry) {
    running += entry.type === "income" ? entry.amount : -entry.amount;
    balanceMap[entry.id] = running;
  });

  const listEl = document.getElementById("ledger-list");
  listEl.innerHTML = "";

  if (list.length === 0) {
    const empty = document.createElement("p");
    empty.className = "placeholder-text";
    empty.textContent = "아직 입력된 내역이 없습니다.";
    listEl.appendChild(empty);
  } else {
    list.forEach(function (entry) {
      listEl.appendChild(buildLedgerListItem(entry, balanceMap[entry.id]));
    });
  }

  document.getElementById("ledger-balance-text").textContent = "현재 잔액 " + formatMoney(getBalance());
}

/**
 * 장부 입력 폼의 내용을 읽어서 검증합니다.
 * 문제가 있으면 안내 후 null을 반환하고, 정상이면 저장할 데이터 객체를 반환합니다.
 */
function readLedgerFormOrAlert() {
  const date = document.getElementById("ledger-date-input").value;
  const content = document.getElementById("ledger-content-input").value.trim();
  const amountRaw = document.getElementById("ledger-amount-input").value;
  const memo = document.getElementById("ledger-memo-input").value.trim();
  const amount = Number(amountRaw);

  if (!date) {
    alert("날짜를 선택해주세요.");
    return null;
  }
  if (!content) {
    alert("내용을 입력해주세요.");
    return null;
  }
  if (amountRaw.trim() === "" || isNaN(amount) || amount <= 0) {
    alert("금액을 올바르게 입력해주세요.");
    return null;
  }

  return {
    date: date,
    type: ledgerSelectedType,
    content: content,
    amount: amount,
    memo: memo
  };
}

/**
 * "저장" 버튼 처리. 추가 모드면 새 항목을, 수정 모드면 기존 항목을 갱신합니다.
 */
function handleLedgerSave() {
  const data = readLedgerFormOrAlert();
  if (!data) {
    return;
  }

  if (ledgerEditingId === null) {
    addLedgerEntry(data);
  } else {
    updateLedgerEntry(ledgerEditingId, data);
  }

  resetLedgerForm();
  renderLedgerScreen();
}

/**
 * 목록에서 "수정" 버튼을 눌렀을 때: 해당 항목 값을 폼에 채우고 수정 모드로 전환합니다.
 */
function startEditLedgerEntry(id) {
  const entry = getLedger().find(function (item) {
    return item.id === id;
  });
  if (!entry) {
    return;
  }

  ledgerEditingId = id;
  ledgerSelectedType = entry.type;
  updateTypeToggleUI();

  document.getElementById("ledger-date-input").value = entry.date;
  document.getElementById("ledger-content-input").value = entry.content;
  document.getElementById("ledger-amount-input").value = entry.amount;
  document.getElementById("ledger-memo-input").value = entry.memo || "";

  document.getElementById("ledger-save-btn").textContent = "수정 완료";
  document.getElementById("ledger-cancel-edit-btn").classList.remove("hidden");

  const formEl = document.querySelector(".ledger-form");
  if (formEl.scrollIntoView) {
    formEl.scrollIntoView({ behavior: "smooth" });
  }
}

/**
 * 목록에서 "삭제" 버튼을 눌렀을 때: 확인 후 삭제합니다.
 */
function handleLedgerDelete(id) {
  const confirmed = confirm("이 내역을 삭제하시겠습니까?");
  if (!confirmed) {
    return;
  }
  deleteLedgerEntry(id);
  if (ledgerEditingId === id) {
    resetLedgerForm();
  }
  renderLedgerScreen();
}

/**
 * 장부 목록의 수정/삭제 버튼 클릭을 처리합니다. (이벤트 위임)
 */
function handleLedgerListClick(event) {
  const editBtn = event.target.closest(".ledger-edit-btn");
  if (editBtn) {
    startEditLedgerEntry(editBtn.dataset.id);
    return;
  }
  const deleteBtn = event.target.closest(".ledger-delete-btn");
  if (deleteBtn) {
    handleLedgerDelete(deleteBtn.dataset.id);
  }
}

/**
 * 장부 화면의 모든 버튼에 이벤트를 연결합니다. (앱 시작 시 한 번만 호출)
 */
function initLedgerScreen() {
  document.getElementById("type-income-btn").addEventListener("click", function () {
    ledgerSelectedType = "income";
    updateTypeToggleUI();
  });
  document.getElementById("type-expense-btn").addEventListener("click", function () {
    ledgerSelectedType = "expense";
    updateTypeToggleUI();
  });

  document.getElementById("ledger-save-btn").addEventListener("click", handleLedgerSave);
  document.getElementById("ledger-cancel-edit-btn").addEventListener("click", resetLedgerForm);
  document.getElementById("ledger-list").addEventListener("click", handleLedgerListClick);

  resetLedgerForm();
}

/* ============================================
   결산 화면
   ============================================ */

const PAYMENT_STATUS_LABELS = {
  paid: "납부",
  partial: "일부납부",
  unpaid: "미납",
  unknown: "미확인"
};

/* 현재 결산 화면에서 보고 있는 탭 ("monthly" | "overall") */
let summaryActiveTab = "monthly";

/* 월별결산 탭에서 보고 있는 달의 위치 (납부관리 화면과 별개로 관리) */
let summaryMonthIndex = null;

/**
 * 월별결산 탭의 월 상태가 아직 계산되지 않았으면 최초 1회 계산합니다.
 */
function ensureSummaryMonthState() {
  if (summaryMonthIndex === null) {
    summaryMonthIndex = getDefaultMonthIndex(getMonthList());
  }
}

/**
 * 회원 한 명의 전체 운영기간 납부 통계를 계산합니다.
 */
function computeMemberOverallStats(memberId) {
  const monthList = getMonthList();
  const settings = getSettings();

  let paidCount = 0;
  let partialCount = 0;
  let unpaidCount = 0;
  let unknownCount = 0;
  let totalCollected = 0;
  const unpaidMonthLabels = [];

  monthList.forEach(function (monthKey) {
    const payment = getPaymentsForMonth(monthKey)[memberId];
    if (payment.status === "paid") {
      paidCount += 1;
      totalCollected += settings.monthlyFee;
    } else if (payment.status === "partial") {
      partialCount += 1;
      totalCollected += payment.amount;
    } else if (payment.status === "unpaid") {
      unpaidCount += 1;
      unpaidMonthLabels.push(formatMonthLabel(monthKey));
    } else {
      unknownCount += 1;
    }
  });

  return {
    paidCount: paidCount,
    partialCount: partialCount,
    unpaidCount: unpaidCount,
    unknownCount: unknownCount,
    totalCollected: totalCollected,
    unpaidMonthLabels: unpaidMonthLabels
  };
}

/**
 * 탭 버튼과 패널의 활성 상태를 전환합니다.
 */
function switchSummaryTab(tab) {
  summaryActiveTab = tab;

  document.getElementById("tab-monthly-btn").classList.toggle("active", tab === "monthly");
  document.getElementById("tab-overall-btn").classList.toggle("active", tab === "overall");

  document.getElementById("summary-monthly").classList.toggle("hidden", tab !== "monthly");
  document.getElementById("summary-overall").classList.toggle("hidden", tab !== "overall");

  renderSummaryScreen();
}

/**
 * 월별결산 패널을 그립니다.
 */
function renderSummaryMonthlyPanel() {
  ensureSummaryMonthState();
  const monthList = getMonthList();
  const monthKey = monthList[summaryMonthIndex];

  document.getElementById("summary-current-month-label").textContent = formatMonthLabel(monthKey);
  document.getElementById("summary-btn-prev-month").disabled = summaryMonthIndex === 0;
  document.getElementById("summary-btn-next-month").disabled = summaryMonthIndex === monthList.length - 1;

  // 해당 월(monthKey)에 속하는 장부 내역만 골라서 입금/출금 합계 계산
  const ledger = getLedger();
  let monthIncome = 0;
  let monthExpense = 0;
  ledger.forEach(function (entry) {
    if (entry.date.indexOf(monthKey) === 0) {
      if (entry.type === "income") {
        monthIncome += entry.amount;
      } else {
        monthExpense += entry.amount;
      }
    }
  });

  document.getElementById("summary-month-income").textContent = formatMoney(monthIncome);
  document.getElementById("summary-month-expense").textContent = formatMoney(monthExpense);
  document.getElementById("summary-month-net").textContent = formatMoney(monthIncome - monthExpense);

  const members = getMembers();
  const monthPayments = getPaymentsForMonth(monthKey);
  const listEl = document.getElementById("summary-month-member-list");
  listEl.innerHTML = "";

  members.forEach(function (member) {
    const payment = monthPayments[member.id];
    const li = document.createElement("li");
    li.className = "summary-member-row";

    const nameSpan = document.createElement("span");
    nameSpan.className = "summary-member-name";
    nameSpan.textContent = member.name;

    const badge = document.createElement("span");
    badge.className = "status-badge status-" + payment.status;
    badge.textContent = PAYMENT_STATUS_LABELS[payment.status] + (payment.status === "partial" ? " (" + formatMoney(payment.amount) + ")" : "");

    li.appendChild(nameSpan);
    li.appendChild(badge);
    listEl.appendChild(li);
  });
}

/**
 * 전체결산 패널을 그립니다.
 */
function renderSummaryOverallPanel() {
  const ledger = getLedger();
  let totalIncome = 0;
  let totalExpense = 0;
  ledger.forEach(function (entry) {
    if (entry.type === "income") {
      totalIncome += entry.amount;
    } else {
      totalExpense += entry.amount;
    }
  });

  document.getElementById("summary-total-income").textContent = formatMoney(totalIncome);
  document.getElementById("summary-total-expense").textContent = formatMoney(totalExpense);
  document.getElementById("summary-total-balance").textContent = formatMoney(getBalance());

  const members = getMembers();
  const listEl = document.getElementById("summary-overall-member-list");
  listEl.innerHTML = "";

  members.forEach(function (member) {
    const stats = computeMemberOverallStats(member.id);

    const li = document.createElement("li");
    li.className = "summary-member-row summary-member-row-overall";

    const topRow = document.createElement("div");
    topRow.className = "summary-member-top";

    const nameSpan = document.createElement("span");
    nameSpan.className = "summary-member-name";
    nameSpan.textContent = member.name;

    const countSpan = document.createElement("span");
    countSpan.className = "summary-member-count";
    countSpan.textContent = "납부 " + stats.paidCount + "회 · 일부 " + stats.partialCount + "회 · 미납 " + stats.unpaidCount + "회";

    topRow.appendChild(nameSpan);
    topRow.appendChild(countSpan);

    const bottomRow = document.createElement("div");
    bottomRow.className = "summary-member-bottom";
    bottomRow.textContent = "누적 납부액 " + formatMoney(stats.totalCollected);
    if (stats.unpaidMonthLabels.length > 0) {
      bottomRow.textContent += " · 미납월: " + stats.unpaidMonthLabels.join(", ");
    }

    li.appendChild(topRow);
    li.appendChild(bottomRow);
    listEl.appendChild(li);
  });
}

/**
 * 결산 화면 전체를 그립니다. (현재 활성화된 탭만 실제로 다시 그림)
 */
function renderSummaryScreen() {
  if (summaryActiveTab === "monthly") {
    renderSummaryMonthlyPanel();
  } else {
    renderSummaryOverallPanel();
  }
}

/**
 * 결산 화면의 모든 버튼에 이벤트를 연결합니다. (앱 시작 시 한 번만 호출)
 */
function initSummaryScreen() {
  document.getElementById("tab-monthly-btn").addEventListener("click", function () {
    switchSummaryTab("monthly");
  });
  document.getElementById("tab-overall-btn").addEventListener("click", function () {
    switchSummaryTab("overall");
  });

  document.getElementById("summary-btn-prev-month").addEventListener("click", function () {
    ensureSummaryMonthState();
    if (summaryMonthIndex > 0) {
      summaryMonthIndex -= 1;
      renderSummaryMonthlyPanel();
    }
  });
  document.getElementById("summary-btn-next-month").addEventListener("click", function () {
    ensureSummaryMonthState();
    const monthList = getMonthList();
    if (summaryMonthIndex < monthList.length - 1) {
      summaryMonthIndex += 1;
      renderSummaryMonthlyPanel();
    }
  });
}

/* ============================================
   백업 화면
   ============================================ */

/**
 * 오늘 날짜를 "2026-07-28" 형태의 파일명용 문자열로 만듭니다.
 */
function getTodayDateStringForFile() {
  const now = new Date();
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
}

/**
 * 현재 저장된 모든 데이터를 JSON 파일로 내보냅니다.
 */
function handleBackupExport() {
  const backupData = {
    appName: "앵두모임",
    exportedAt: new Date().toISOString(),
    data: {
      members: getMembers(),
      settings: getSettings(),
      payments: getPayments(),
      ledger: getLedger()
    }
  };

  const json = JSON.stringify(backupData, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = "앵두모임_백업_" + getTodayDateStringForFile() + ".json";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  const statusEl = document.getElementById("backup-status-text");
  statusEl.textContent = "백업 파일이 저장되었습니다.";
  statusEl.className = "backup-status backup-status-success";
}

/**
 * 백업 파일 데이터의 형태가 올바른지 최소한으로 확인합니다.
 */
function isValidBackupData(parsed) {
  return Boolean(
    parsed &&
    parsed.data &&
    Array.isArray(parsed.data.members) &&
    parsed.data.settings &&
    parsed.data.payments &&
    Array.isArray(parsed.data.ledger)
  );
}

/**
 * 선택한 백업 파일을 읽어서 복원합니다.
 */
function handleBackupFileSelected(event) {
  const file = event.target.files[0];
  const statusEl = document.getElementById("backup-status-text");

  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = function () {
    let parsed;
    try {
      parsed = JSON.parse(reader.result);
    } catch (error) {
      statusEl.textContent = "올바른 백업 파일이 아닙니다.";
      statusEl.className = "backup-status backup-status-error";
      event.target.value = "";
      return;
    }

    if (!isValidBackupData(parsed)) {
      statusEl.textContent = "올바른 앵두모임 백업 파일이 아닙니다.";
      statusEl.className = "backup-status backup-status-error";
      event.target.value = "";
      return;
    }

    const confirmed = confirm("복원하면 현재 저장된 모든 자료가 사라지고 백업 파일 내용으로 바뀝니다.\n계속하시겠습니까?");
    if (!confirmed) {
      event.target.value = "";
      return;
    }

    writeJSON(STORAGE_KEYS.MEMBERS, parsed.data.members);
    writeJSON(STORAGE_KEYS.SETTINGS, parsed.data.settings);
    writeJSON(STORAGE_KEYS.PAYMENTS, parsed.data.payments);
    writeJSON(STORAGE_KEYS.LEDGER, parsed.data.ledger);

    alert("복원이 완료되었습니다. 앱을 다시 불러옵니다.");
    location.reload();
  };

  reader.onerror = function () {
    statusEl.textContent = "파일을 읽는 중 문제가 발생했습니다.";
    statusEl.className = "backup-status backup-status-error";
  };

  reader.readAsText(file);
}

/**
 * 백업 화면의 버튼에 이벤트를 연결합니다. (앱 시작 시 한 번만 호출)
 */
function initBackupScreen() {
  document.getElementById("backup-export-btn").addEventListener("click", handleBackupExport);

  const fileInput = document.getElementById("backup-file-input");
  document.getElementById("backup-import-btn").addEventListener("click", function () {
    fileInput.click();
  });
  fileInput.addEventListener("change", handleBackupFileSelected);
}
