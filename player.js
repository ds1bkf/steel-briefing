/* 지난 밤 철강 뉴스 - 음성 재생기 (Web Speech API)
   index.html 안의 <script type="application/json" id="tts-script"> 대본을 읽어 재생한다.
   각 단락의 group 값(weather / global / steel / domestic)으로 구간 재생을 지원하고,
   지금 읽고 있는 섹터를 색으로 강조한다. 외부 통신 없음, API 키 없음, 비용 없음. */
(function () {
  'use strict';

  var box = document.getElementById('tts-script');
  var bar = document.getElementById('tts-bar');
  if (!box || !bar) return;

  var elPlay  = document.getElementById('tts-play');
  var elPause = document.getElementById('tts-pause');
  var elStop  = document.getElementById('tts-stop');
  var elRate  = document.getElementById('tts-rate');
  var elSecs  = document.getElementById('tts-sections');
  var elPanel = document.getElementById('tts-panel');
  var elHint  = document.getElementById('tts-hint');
  var elDot   = document.getElementById('tts-dot');
  var elLabel = document.getElementById('tts-label');
  var elPct   = document.getElementById('tts-pct');
  var elFill  = document.getElementById('tts-fill');

  // 섹터별 강조색 — 본문 섹터 색과 동일하게 맞춘다
  var GROUP_COLOR = { weather:'#0891b2', global:'#2563eb', steel:'#ea580c', domestic:'#dc2626', intro:'#9fb3c8', outro:'#9fb3c8' };

  // ── 미지원 브라우저 처리 ────────────────────────────────
  if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
    elPlay.disabled = true;
    elPlay.textContent = '음성 재생 미지원 브라우저';
    if (elPanel) elPanel.hidden = true;
    return;
  }

  var synth = window.speechSynthesis;
  var segments;
  try { segments = JSON.parse(box.textContent); } catch (e) { return; }
  if (!segments || !segments.length) return;

  // ── 대본을 문장 단위로 쪼갠다 ───────────────────────────
  // 크롬은 긴 문장을 한 번에 넣으면 약 15초에서 끊기는 알려진 버그가 있어
  // 문장 단위(최대 180자)로 나눠 큐로 넣는다.
  var MAX = 180;
  function splitToSentences(text) {
    // 구형 사파리가 lookbehind 정규식을 못 읽으므로 쓰지 않는다
    var raw = text.replace(/\s+/g, ' ').trim().match(/[^.?!]+[.?!]*\s*/g) || [text];
    var out = [];
    raw.forEach(function (s) {
      s = s.trim();
      if (!s) return;
      while (s.length > MAX) {
        var cut = s.lastIndexOf(', ', MAX);
        if (cut < MAX * 0.4) cut = s.lastIndexOf(' ', MAX);
        if (cut < MAX * 0.4) cut = MAX;
        out.push(s.slice(0, cut).trim());
        s = s.slice(cut).trim();
      }
      if (s) out.push(s);
    });
    return out;
  }

  var chunks = [];
  segments.forEach(function (seg, si) {
    splitToSentences(seg.text).forEach(function (s) {
      chunks.push({ text: s, seg: si });
    });
  });

  // 그룹 이름으로 청크 구간을 찾는다
  function rangeOf(group) {
    var from = -1, to = -1;
    for (var i = 0; i < chunks.length; i++) {
      if (segments[chunks[i].seg].group === group) {
        if (from < 0) from = i;
        to = i + 1;
      }
    }
    return from < 0 ? null : [from, to];
  }

  // ── 한국어 음성 고르기 ─────────────────────────────────
  var voice = null;
  function pickVoice() {
    var list = synth.getVoices() || [];
    var ko = list.filter(function (v) { return /^ko/i.test(v.lang); });
    if (!ko.length) return null;
    var pref = ['Google', 'Yuna', 'Heami', 'Sora', 'Nuri'];
    for (var i = 0; i < pref.length; i++) {
      var hit = ko.filter(function (v) { return v.name.indexOf(pref[i]) !== -1; })[0];
      if (hit) return hit;
    }
    return ko[0];
  }
  voice = pickVoice();
  if (synth.onvoiceschanged !== undefined) {
    synth.addEventListener('voiceschanged', function () { voice = pickVoice() || voice; });
  }

  // ── 상태 ───────────────────────────────────────────────
  var idx = 0;                 // 현재 청크
  var startAt = 0;             // 재생 구간 시작
  var endAt = chunks.length;   // 재생 구간 끝(미포함)
  var curGroup = null;         // null이면 전체 듣기
  var playing = false, paused = false, rate = 1.0, watchdog = null;

  // ── 화면 꺼짐 방지 ─────────────────────────────────────
  // 휴대폰 화면이 꺼지면 브라우저가 페이지를 멈춰 음성도 끊긴다.
  // 재생 중에는 화면을 켜 둬서 끊김을 줄인다. (지원하지 않는 기기는 그냥 넘어간다)
  var wakeLock = null;
  function acquireWakeLock() {
    if (!('wakeLock' in navigator) || wakeLock) return;
    try {
      navigator.wakeLock.request('screen').then(function (l) {
        wakeLock = l;
        l.addEventListener('release', function () { wakeLock = null; });
      })['catch'](function () { /* 거부되면 무시 */ });
    } catch (e) { /* 무시 */ }
  }
  function releaseWakeLock() {
    if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
  }

  function render() {
    // 정지 상태에서는 시작 버튼만, 재생 중에는 패널(일시정지·정지·배속이 한 줄)만 보인다
    elPlay.hidden = playing;
    if (!playing) elPlay.innerHTML = '<span aria-hidden="true">&#9654;</span> 음성으로 듣기';
    if (elPause) {
      elPause.innerHTML = paused
        ? '<span aria-hidden="true">&#9654;</span> 이어 듣기'
        : '<span aria-hidden="true">&#10074;&#10074;</span> 일시정지';
    }
    if (elPanel) elPanel.hidden = !playing;
    if (elHint) elHint.hidden = playing;
    if (!playing) {
      if (elSecs) Array.prototype.forEach.call(elSecs.querySelectorAll('button'), function (b) { b.classList.remove('is-live'); });
      return;
    }

    // 지금 읽고 있는 단락과 섹터
    var seg = segments[chunks[Math.min(idx, endAt - 1)].seg];
    var g = seg.group;
    var color = GROUP_COLOR[g] || '#9fb3c8';

    if (elLabel) elLabel.textContent = seg.label;
    if (elDot) elDot.style.background = color;

    var span = Math.max(1, endAt - startAt);
    var pct = Math.min(100, Math.round(((idx - startAt) / span) * 100));
    if (elPct) elPct.textContent = paused ? '일시정지' : pct + '%';
    if (elFill) { elFill.style.width = pct + '%'; elFill.style.background = color; }

    // 현재 읽는 섹터의 탭을 그 섹터 색으로 강조 (전체 듣기 중에도 자동으로 이동)
    if (elSecs) {
      Array.prototype.forEach.call(elSecs.querySelectorAll('button[data-group]'), function (b) {
        b.classList.toggle('is-live', b.getAttribute('data-group') === g);
      });
    }
  }

  // 크롬이 장시간 재생 중 스스로 멈추는 것을 막는 감시 타이머
  function startWatchdog() {
    stopWatchdog();
    watchdog = setInterval(function () {
      if (playing && !paused && !synth.speaking) speakNext();
    }, 1200);
  }
  function stopWatchdog() { if (watchdog) { clearInterval(watchdog); watchdog = null; } }

  function speakNext() {
    if (!playing || paused) return;
    if (idx >= endAt) { finish(); return; }
    var u = new SpeechSynthesisUtterance(chunks[idx].text);
    u.lang = 'ko-KR';
    if (voice) u.voice = voice;
    u.rate = rate;
    u.pitch = 1.0;
    u.onend = function () {
      if (!playing || paused) return;
      idx += 1;
      render();
      speakNext();
    };
    u.onerror = function (ev) {
      if (ev && (ev.error === 'canceled' || ev.error === 'interrupted')) return;
      idx += 1;
      if (playing && !paused) speakNext();
    };
    synth.speak(u);
    render();
  }

  function play(from, to, group) {
    synth.cancel();
    startAt = from; endAt = to; idx = from; curGroup = group || null;
    playing = true; paused = false;
    acquireWakeLock();
    startWatchdog();
    speakNext();
    render();
  }

  function pause() {
    paused = true;
    synth.cancel();   // pause()가 불안정한 브라우저가 있어 취소 후 위치를 기억한다
    stopWatchdog();
    releaseWakeLock();
    render();
  }

  function resume() {
    paused = false;
    acquireWakeLock();
    startWatchdog();
    speakNext();
    render();
  }

  function finish() {
    playing = false; paused = false;
    idx = startAt;
    synth.cancel();
    stopWatchdog();
    releaseWakeLock();
    render();
  }

  // ── 이벤트 ─────────────────────────────────────────────
  elPlay.addEventListener('click', function () {
    if (!playing) play(0, chunks.length, null);
  });

  if (elPause) {
    elPause.addEventListener('click', function () {
      if (!playing) return;
      if (paused) resume(); else pause();
    });
  }

  elStop.addEventListener('click', finish);

  elRate.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('button[data-rate]') : null;
    if (!btn) return;
    rate = parseFloat(btn.getAttribute('data-rate'));
    Array.prototype.forEach.call(elRate.querySelectorAll('button'), function (b) {
      b.classList.toggle('is-on', b === btn);
    });
    if (playing && !paused) { synth.cancel(); speakNext(); }   // 현재 문장부터 새 속도로
  });

  if (elSecs) {
    // 섹터 버튼은 '시작 지점 지정'이다. 그 섹터부터 시작해 뒤 섹터와 닫는 말까지 이어서 읽는다.
    elSecs.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('button[data-group]') : null;
      if (!btn) return;
      var r = rangeOf(btn.getAttribute('data-group'));
      if (r) play(r[0], chunks.length, btn.getAttribute('data-group'));
    });
  }

  window.addEventListener('beforeunload', function () { synth.cancel(); });

  // 다른 탭으로 갔다 돌아오면 화면 꺼짐 방지를 다시 건다.
  // (PC 브라우저는 탭이 뒤로 가도 낭독이 이어진다. 휴대폰은 화면이 꺼지면 멈춘다.)
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && playing && !paused) acquireWakeLock();
  });

  // 예상 재생 시간 (한국어 TTS 대략 분당 330자 기준)
  var total = segments.reduce(function (a, s) { return a + s.text.length; }, 0);
  if (elHint) elHint.textContent = '전체 약 ' + Math.max(1, Math.round(total / 330)) + '분';

  render();
})();
