/* steel-briefing visit tracker (fire-and-forget, no PII, no IP) */
(function () {
  try {
    var NS = "steelbrief-ds1bkf-live";
    var BASE = "https://abacus.jasoncameron.dev/hit/" + NS + "/";
    // KST(UTC+9) 기준 오늘 날짜 키
    var now = new Date();
    var kst = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + 9 * 3600000);
    var mm = String(kst.getMonth() + 1).padStart(2, "0");
    var dd = String(kst.getDate()).padStart(2, "0");
    var day = kst.getFullYear() + "-" + mm + "-" + dd;
    // 총 방문 + 오늘 방문 각각 1 증가 (실패해도 무시)
    fetch(BASE + "total", { keepalive: true }).catch(function () {});
    fetch(BASE + "d-" + day, { keepalive: true }).catch(function () {});
  } catch (e) {}
})()