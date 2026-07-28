/* ============================================
   앵두모임 - storage.js
   LocalStorage 데이터 저장/조회를 전담하는 파일입니다.
   화면(app.js)은 이 파일의 함수만 호출하고,
   LocalStorage 키 이름이나 데이터 형태를 직접 다루지 않습니다.
   ============================================ */

/* ----------- LocalStorage 키 이름 (한 곳에서만 관리) ----------- */
const STORAGE_KEYS = {
  MEMBERS: "angdu_members",
  PAYMENTS: "angdu_payments",
  LEDGER: "angdu_ledger",
  SETTINGS: "angdu_settings"
};

/* ----------- 회원 15명 고정 명단 (순서 변경 금지) ----------- */
const DEFAULT_MEMBERS = [
  { id: 1, name: "임상례 회장님" },
  { id: 2, name: "김명주 전총무님" },
  { id: 3, name: "김춘직" },
  { id: 4, name: "김향희" },
  { id: 5, name: "장갑언니" },
  { id: 6, name: "대왕언니" },
  { id: 7, name: "숙영언니" },
  { id: 8, name: "오복근" },
  { id: 9, name: "송명식" },
  { id: 10, name: "박복계" },
  { id: 11, name: "권태영" },
  { id: 12, name: "이향란" },
  { id: 13, name: "조희경" },
  { id: 14, name: "박병분" },
  { id: 15, name: "김선숙" }
];

/* 기본 설정값 (운영기간 / 월회비) */
const DEFAULT_SETTINGS = {
  monthlyFee: 120000,
  startMonth: "2026-07",
  endMonth: "2027-06"
};

/* ============================================
   내부 공통 함수 (JSON 읽기/쓰기)
   ============================================ */

/**
 * LocalStorage에서 JSON 데이터를 읽어옵니다.
 * 값이 없거나 읽기에 실패하면 fallback 값을 반환합니다.
 */
function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) {
      return fallback;
    }
    return JSON.parse(raw);
  } catch (error) {
    console.error("[storage] 읽기 실패:", key, error);
    return fallback;
  }
}

/**
 * LocalStorage에 JSON 데이터를 저장합니다.
 * 저장 성공 여부(boolean)를 반환합니다.
 */
function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error("[storage] 저장 실패:", key, error);
    return false;
  }
}

/* ============================================
   초기화
   ============================================ */

/**
 * 앱 최초 실행 시 회원 명단 / 설정값이 없으면 기본값으로 채웁니다.
 * 이미 데이터가 있으면 절대 덮어쓰지 않습니다. (기존 데이터 보호)
 */
function initStorage() {
  if (localStorage.getItem(STORAGE_KEYS.MEMBERS) === null) {
    writeJSON(STORAGE_KEYS.MEMBERS, DEFAULT_MEMBERS);
  }
  if (localStorage.getItem(STORAGE_KEYS.SETTINGS) === null) {
    writeJSON(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
  }
  if (localStorage.getItem(STORAGE_KEYS.PAYMENTS) === null) {
    writeJSON(STORAGE_KEYS.PAYMENTS, {});
  }
  if (localStorage.getItem(STORAGE_KEYS.LEDGER) === null) {
    writeJSON(STORAGE_KEYS.LEDGER, []);
  }
}

/* ============================================
   회원 (members)
   ============================================ */

/**
 * 회원 15명 목록을 반환합니다. (고정 순서)
 */
function getMembers() {
  return readJSON(STORAGE_KEYS.MEMBERS, DEFAULT_MEMBERS);
}

/* ============================================
   설정 (settings)
   ============================================ */

/**
 * 월회비, 운영기간 설정값을 반환합니다.
 */
function getSettings() {
  return readJSON(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
}

/* ============================================
   납부 (payments)
   구조: { "2026-07": { 1: {status, amount}, 2: {...}, ... }, ... }
   ============================================ */

/**
 * 전체 납부 데이터를 반환합니다. (모든 월)
 */
function getPayments() {
  return readJSON(STORAGE_KEYS.PAYMENTS, {});
}

/**
 * 특정 월(monthKey 예: "2026-07")의 회원별 납부 현황을 반환합니다.
 * 아직 기록이 없는 회원은 status "unknown"(미확인), amount 0으로 채워서 반환합니다.
 */
function getPaymentsForMonth(monthKey) {
  const allPayments = getPayments();
  const monthData = allPayments[monthKey] || {};
  const members = getMembers();

  const result = {};
  members.forEach(function (member) {
    result[member.id] = monthData[member.id] || { status: "unknown", amount: 0 };
  });
  return result;
}

/**
 * 회원 한 명의 특정 월 납부 상태를 저장합니다.
 * status: "paid"(납부) | "partial"(일부납부) | "unpaid"(미납) | "unknown"(미확인)
 * amount: 실제 수납 금액 (일부납부일 때만 의미 있음. 납부는 자동으로 월회비 전액)
 */
function savePayment(monthKey, memberId, status, amount) {
  const allPayments = getPayments();

  if (!allPayments[monthKey]) {
    allPayments[monthKey] = {};
  }

  allPayments[monthKey][memberId] = {
    status: status,
    amount: amount
  };

  return writeJSON(STORAGE_KEYS.PAYMENTS, allPayments);
}

/* ============================================
   장부 (ledger)
   구조: [{ id, date, type, content, amount, memo }, ...]
   ============================================ */

/**
 * 전체 장부 내역을 반환합니다. (최신순으로 정렬해서 반환)
 */
function getLedger() {
  const list = readJSON(STORAGE_KEYS.LEDGER, []);
  return list.slice().sort(function (a, b) {
    return b.date.localeCompare(a.date) || b.id.localeCompare(a.id);
  });
}

/**
 * 장부에 새 항목(입금 또는 출금)을 추가합니다.
 * entry: { date, type("income"|"expense"), content, amount, memo }
 * id는 자동으로 생성되어 붙습니다.
 */
function addLedgerEntry(entry) {
  const list = readJSON(STORAGE_KEYS.LEDGER, []);
  const newEntry = {
    id: "l_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
    date: entry.date,
    type: entry.type,
    content: entry.content,
    amount: entry.amount,
    memo: entry.memo || ""
  };
  list.push(newEntry);
  writeJSON(STORAGE_KEYS.LEDGER, list);
  return newEntry;
}

/**
 * 장부 항목을 수정합니다. id로 찾아서 나머지 필드를 덮어씁니다.
 */
function updateLedgerEntry(id, updatedFields) {
  const list = readJSON(STORAGE_KEYS.LEDGER, []);
  const index = list.findIndex(function (item) {
    return item.id === id;
  });

  if (index === -1) {
    console.error("[storage] 수정할 장부 항목을 찾지 못함:", id);
    return false;
  }

  list[index] = Object.assign({}, list[index], updatedFields, { id: id });
  return writeJSON(STORAGE_KEYS.LEDGER, list);
}

/**
 * 장부 항목을 삭제합니다.
 */
function deleteLedgerEntry(id) {
  const list = readJSON(STORAGE_KEYS.LEDGER, []);
  const filtered = list.filter(function (item) {
    return item.id !== id;
  });
  return writeJSON(STORAGE_KEYS.LEDGER, filtered);
}

/* ============================================
   계산 함수 (저장된 데이터를 바탕으로 즉시 계산, 별도 저장 안 함)
   ============================================ */

/**
 * 현재 잔액을 계산합니다. (모든 입금 합 - 모든 출금 합)
 * 잔액은 저장하지 않고 항상 장부 데이터로부터 새로 계산합니다.
 * (저장된 잔액과 실제 장부가 어긋나는 일을 방지하기 위함)
 */
function getBalance() {
  const list = readJSON(STORAGE_KEYS.LEDGER, []);
  let balance = 0;
  list.forEach(function (item) {
    if (item.type === "income") {
      balance += item.amount;
    } else if (item.type === "expense") {
      balance -= item.amount;
    }
  });
  return balance;
}

/**
 * 특정 월에 실제로 걷힌 금액(수납액)을 계산합니다.
 * "납부" 상태는 월회비 전액, "일부납부"는 입력된 금액으로 합산합니다.
 */
function getMonthlyCollectedAmount(monthKey) {
  const monthPayments = getPaymentsForMonth(monthKey);
  const members = getMembers();
  const settings = getSettings();

  let collected = 0;
  members.forEach(function (member) {
    const p = monthPayments[member.id];
    if (p.status === "paid") {
      collected += settings.monthlyFee;
    } else if (p.status === "partial") {
      collected += p.amount;
    }
  });
  return collected;
}

/**
 * 특정 월의 목표 금액(회원수 * 월회비)을 계산합니다.
 */
function getMonthlyTargetAmount() {
  return getMembers().length * getSettings().monthlyFee;
}

/**
 * 특정 월의 납부율(%)을 계산합니다.
 * 납부율 = 해당 월 실제 수납 금액 합계 / (회원수 * 월회비) * 100
 * "납부" 상태는 월회비 전액, "일부납부"는 입력된 금액으로 계산합니다.
 */
function getMonthlyPaymentRate(monthKey) {
  const collected = getMonthlyCollectedAmount(monthKey);
  const target = getMonthlyTargetAmount();

  if (target === 0) {
    return 0;
  }
  return Math.round((collected / target) * 100);
}
