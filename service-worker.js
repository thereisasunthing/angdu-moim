/* ============================================
   앵두모임 - service-worker.js
   오프라인에서도 앱이 동작하도록 파일을 캐시합니다.

   버전을 올리는 방법:
   - 파일 내용을 수정한 뒤 배포할 때는 CACHE_NAME의 숫자를 올려주세요.
     (v1 -> v2) 그래야 사용자 휴대폰의 캐시가 새 파일로 교체됩니다.
   ============================================ */

const CACHE_NAME = "angdu-moim-v3";

const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./storage.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

/**
 * 설치 시점: 앱에 필요한 모든 파일을 미리 캐시에 저장합니다.
 */
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(FILES_TO_CACHE);
    })
  );
  self.skipWaiting();
});

/**
 * 활성화 시점: 이전 버전의 캐시가 남아있으면 정리합니다.
 */
self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keyList) {
      return Promise.all(
        keyList.map(function (key) {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return null;
        })
      );
    })
  );
  self.clients.claim();
});

/**
 * 요청 처리: 캐시에 있으면 캐시를 먼저 사용하고(오프라인 대응),
 * 없으면 네트워크에서 가져옵니다. (이 앱은 외부 서버 요청이 없음)
 */
self.addEventListener("fetch", function (event) {
  event.respondWith(
    caches.match(event.request).then(function (cachedResponse) {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).catch(function () {
        // 네트워크도 캐시도 없는 경우 (예: 최초 접속 실패) 홈 화면으로 대체
        return caches.match("./index.html");
      });
    })
  );
});
