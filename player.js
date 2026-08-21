/* 지난 밤 철강 뉴스 - 음성 재생기 (Web Speech API)
   index.html 안의 <script type="application/json" id="tts-script"> 대본을 읽어 재생한다.
   각 단락의 group 값(weather / global / steel / domestic)으로 구간 재생을 지원한다.
   외부 통신 없음, API 키 없음, 비용 없음. */
(function () {
  'use strict';

  var box = document.getElementById('tts-script');
  var bar = document.getElementById('tts-bar');
  if (!box || !bar) return;

  var elPlay = document.getElementById('tts-play');
  var elStop = document.getElementById('tts-stop');
  var elRate = document.getElementById('tts-rate');
  var elSecs = document.getElementById('tts-sections');
  var elStatus = document.getElementById('tts-status');
  var elHint = document.getElementById('tts-hint');

  // ── 미지원 브라우저 처리 ────────────────────────────────
  if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
    elPlay.disabled = true;
    elPlay.textContent = '음성 재생 미지원 브라우저';
    if (elSecs) elSecs.hidden = true;
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

  function markSection() {
    if (!elSecs) return;
    Array.prototype.forEach.call(elSecs.querySelectorAll('button[data-group]'), function (b) {
      b.classList.toggle('is-on', playing && b.getAttribute('data-group') === curGroup);
    });
  }

  function render() {
    if (playing && !paused) {
      elPlay.innerHTML = '<span aria-hidden="true">&#10074;&#10074;</span> 일시정지';
    } else if (playing && paused) {
      elPlay.innerHTML = '<span aria-hidden="true">&#9654;</span> 이어 듣기';
    } else {
      elPlay.innerHTML = '<span aria-hidden="true">&#9654;</span> 음성으로 듣기';
    }
    elStop.hidden = !playing;
    elRate.hidden = !playing;
    markSection();

    if (playing) {
      var seg = segments[chunks[Math.min(idx, endAt - 1)].seg];
      var span = Math.max(1, endAt - startAt);
      var pct = Math.round(((idx - startAt) / span) * 100);
      elStatus.textContent = (paused ? '일시정지 · ' : '재생 중 · ') + seg.label + ' (' + pct + '%)';
    } else {
      elStatus.textContent = '';
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
    startWatchdog();
    speakNext();
    render();
  }

  function pause() {
    paused = true;
    synth.cancel();   // pause()가 불안정한 브라우저가 있어 취소 후 위치를 기억한다
    stopWatchdog();
    render();
  }

  function resume() {
    paused = false;
    startWatchdog();
    speakNext();
    render();
  }

  function finish() {
    playing = false; paused = false;
    idx = startAt;
    synth.cancel();
    stopWatchdog();
    render();
  }

  // ── 이벤트 ─────────────────────────────────────────────
  elPlay.addEventListener('click', function () {
    if (!playing) play(0, chunks.length, null);
    else if (paused) resume();
    else pause();
  });

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
    elSecs.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('button[data-group]') : null;
      if (!btn) return;
      var g = btn.getAttribute('data-group');
      if (playing && curGroup === g && !paused) { finish(); return; }  // 같은 구간 다시 누르면 정지
      var r = rangeOf(g);
      if (r) play(r[0], r[1], g);
    });
  }

  window.addEventListener('beforeunload', function () { synth.cancel(); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && playing && !paused) pause();
  });

  // 예상 재생 시간 (한국어 TTS 대략 분당 330자 기준)
  var total = segments.reduce(function (a, s) { return a + s.text.length; }, 0);
  if (elHint) elHint.textContent = '전체 약 ' + Math.max(1, Math.round(total / 330)) + '분';

  render();
})();
