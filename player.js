/* 지난 밤 철강 뉴스 - 음성 재생기 (Web Speech API)
   index.html 안의 <script type="application/json" id="tts-script"> 대본을 읽어 재생한다.
   외부 통신 없음, API 키 없음, 비용 없음. */
(function () {
  'use strict';

  var box = document.getElementById('tts-script');
  var bar = document.getElementById('tts-bar');
  if (!box || !bar) return;

  var elPlay = document.getElementById('tts-play');
  var elStop = document.getElementById('tts-stop');
  var elRate = document.getElementById('tts-rate');
  var elStatus = document.getElementById('tts-status');

  // ── 미지원 브라우저 처리 ────────────────────────────────
  if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
    elPlay.disabled = true;
    elPlay.textContent = '음성 재생 미지원 브라우저';
    return;
  }

  var synth = window.speechSynthesis;
  var segments;
  try { segments = JSON.parse(box.textContent); } catch (e) { return; }
  if (!segments || !segments.length) return;

  // ── 대본을 문장 단위로 쪼갠다 ───────────────────────────
  // 크롬은 한 번에 긴 문장을 넣으면 약 15초에서 끊기는 알려진 버그가 있어
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

  // ── 한국어 음성 고르기 ─────────────────────────────────
  var voice = null;
  function pickVoice() {
    var list = synth.getVoices() || [];
    var ko = list.filter(function (v) { return /^ko/i.test(v.lang); });
    if (!ko.length) return null;
    // 품질이 나은 편인 음성을 우선한다.
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
  var idx = 0;          // 현재 청크 위치
  var playing = false;  // 재생 중
  var paused = false;   // 일시정지
  var rate = 1.0;
  var watchdog = null;

  function setStatus(t) { elStatus.textContent = t || ''; }

  function render() {
    if (playing && !paused) {
      elPlay.innerHTML = '<span aria-hidden="true">❚❚</span> 일시정지';
      elPlay.setAttribute('aria-label', '일시정지');
    } else if (playing && paused) {
      elPlay.innerHTML = '<span aria-hidden="true">▶</span> 이어 듣기';
      elPlay.setAttribute('aria-label', '이어 듣기');
    } else {
      elPlay.innerHTML = '<span aria-hidden="true">▶</span> 음성으로 듣기';
      elPlay.setAttribute('aria-label', '음성으로 듣기');
    }
    elStop.hidden = !playing;
    elRate.hidden = !playing;
    if (playing) {
      var s = segments[chunks[Math.min(idx, chunks.length - 1)].seg];
      var pct = Math.round((idx / chunks.length) * 100);
      setStatus((paused ? '일시정지 · ' : '재생 중 · ') + s.label + ' (' + pct + '%)');
    } else {
      setStatus('');
    }
  }

  // 크롬이 장시간 재생에서 스스로 멈추는 것을 막는 감시 타이머
  function startWatchdog() {
    stopWatchdog();
    watchdog = setInterval(function () {
      if (playing && !paused && !synth.speaking) { speakNext(); }
    }, 1200);
  }
  function stopWatchdog() { if (watchdog) { clearInterval(watchdog); watchdog = null; } }

  function speakNext() {
    if (!playing || paused) return;
    if (idx >= chunks.length) { finish(); return; }
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

  function start() {
    synth.cancel();
    playing = true;
    paused = false;
    if (idx >= chunks.length) idx = 0;
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
    playing = false;
    paused = false;
    idx = 0;
    synth.cancel();
    stopWatchdog();
    render();
  }

  // ── 이벤트 ─────────────────────────────────────────────
  elPlay.addEventListener('click', function () {
    if (!playing) start();
    else if (paused) resume();
    else pause();
  });

  elStop.addEventListener('click', finish);

  elRate.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-rate]');
    if (!btn) return;
    rate = parseFloat(btn.getAttribute('data-rate'));
    Array.prototype.forEach.call(elRate.querySelectorAll('button'), function (b) {
      b.classList.toggle('is-on', b === btn);
    });
    if (playing && !paused) {   // 현재 문장부터 새 속도로 다시 읽는다
      synth.cancel();
      speakNext();
    }
  });

  // 페이지를 벗어나면 소리를 끊는다
  window.addEventListener('beforeunload', function () { synth.cancel(); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && playing && !paused) pause();
  });

  // 예상 재생 시간 안내 (한국어 TTS 대략 분당 330자 기준)
  var total = segments.reduce(function (a, s) { return a + s.text.length; }, 0);
  var mins = Math.max(1, Math.round(total / 330));
  bar.setAttribute('data-mins', mins);
  var hint = document.getElementById('tts-hint');
  if (hint) hint.textContent = '약 ' + mins + '분 · 날씨와 배차부터 안내합니다';

  render();
})();
