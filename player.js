/* 지난 밤 철강 뉴스 - 음성 재생기
   1순위: 새벽에 만들어 둔 audio.mp3 + chapters.json (구글 TTS, 자연스러운 음성)
   2순위: MP3가 없으면 브라우저 내장 음성(Web Speech API)으로 자동 전환
   두 방식 모두 지금 읽는 섹터를 색으로 강조한다. */
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
  var elProg  = elFill ? elFill.parentNode : null;

  var GROUP_COLOR = { weather:'#0891b2', global:'#2563eb', steel:'#ea580c',
                      domestic:'#dc2626', intro:'#9fb3c8', outro:'#9fb3c8' };
  var VER = bar.getAttribute('data-audio-v') || '1';

  var segments;
  try { segments = JSON.parse(box.textContent); } catch (e) { return; }
  if (!segments || !segments.length) return;

  // ── 공통 표시 도우미 ───────────────────────────────────
  function paint(group, label, pct, note) {
    var color = GROUP_COLOR[group] || '#9fb3c8';
    if (elLabel) elLabel.textContent = label || '';
    if (elDot) elDot.style.background = color;
    if (elPct) elPct.textContent = note || (Math.round(pct) + '%');
    if (elFill) { elFill.style.width = Math.max(0, Math.min(100, pct)) + '%'; elFill.style.background = color; }
    if (elSecs) {
      Array.prototype.forEach.call(elSecs.querySelectorAll('button[data-group]'), function (b) {
        b.classList.toggle('is-live', b.getAttribute('data-group') === group);
      });
    }
  }
  function clearMarks() {
    if (elSecs) Array.prototype.forEach.call(elSecs.querySelectorAll('button'), function (b) {
      b.classList.remove('is-live');
    });
  }
  function setButtons(playing, paused) {
    elPlay.hidden = playing;
    if (!playing) elPlay.innerHTML = '<span aria-hidden="true">&#9654;</span> 음성으로 듣기';
    if (elPause) elPause.innerHTML = paused
      ? '<span aria-hidden="true">&#9654;</span> 이어 듣기'
      : '<span aria-hidden="true">&#10074;&#10074;</span> 일시정지';
    if (elPanel) elPanel.hidden = !playing;
    if (elHint) elHint.hidden = playing;
    if (!playing) clearMarks();
  }
  function mmss(sec) {
    if (!isFinite(sec)) return '';
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  // ══════════════════════════════════════════════════════
  //  1순위 — MP3 재생 모드
  // ══════════════════════════════════════════════════════
  function initAudioMode(chapters) {
    var audio = new Audio('audio.mp3?v=' + VER);
    audio.preload = 'metadata';

    var started = false;

    function current() {
      var t = audio.currentTime;
      for (var i = 0; i < chapters.length; i++) {
        if (t < chapters[i].end) return chapters[i];
      }
      return chapters[chapters.length - 1];
    }

    function render() {
      var playing = started;
      setButtons(playing, playing && audio.paused);
      if (!playing) return;
      var c = current();
      var d = audio.duration || 0;
      var pct = d ? (audio.currentTime / d) * 100 : 0;
      paint(c.group, c.label,
            pct,
            audio.paused ? '일시정지' : mmss(audio.currentTime) + ' / ' + mmss(d));
    }

    audio.addEventListener('timeupdate', render);
    audio.addEventListener('play', render);
    audio.addEventListener('pause', render);
    audio.addEventListener('ended', function () { started = false; audio.currentTime = 0; render(); });

    elPlay.addEventListener('click', function () {
      started = true;
      audio.play();
      render();
    });
    if (elPause) elPause.addEventListener('click', function () {
      if (!started) return;
      if (audio.paused) audio.play(); else audio.pause();
    });
    elStop.addEventListener('click', function () {
      started = false; audio.pause(); audio.currentTime = 0; render();
    });

    elRate.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('button[data-rate]') : null;
      if (!btn) return;
      audio.playbackRate = parseFloat(btn.getAttribute('data-rate'));
      Array.prototype.forEach.call(elRate.querySelectorAll('button'), function (b) {
        b.classList.toggle('is-on', b === btn);
      });
    });

    // 섹터 버튼 = 그 지점으로 이동해 끝까지 이어 듣기
    if (elSecs) elSecs.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('button[data-group]') : null;
      if (!btn) return;
      var g = btn.getAttribute('data-group'), c = null;
      for (var i = 0; i < chapters.length; i++) { if (chapters[i].group === g) { c = chapters[i]; break; } }
      if (!c) return;
      started = true;
      audio.currentTime = c.start;
      audio.play();
      render();
    });

    // 진행 바를 눌러 원하는 지점으로 이동
    if (elProg) {
      elProg.style.cursor = 'pointer';
      elProg.addEventListener('click', function (e) {
        if (!audio.duration) return;
        var r = elProg.getBoundingClientRect();
        audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
        render();
      });
    }

    // 잠금화면·이어폰·차량 버튼 연동
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new window.MediaMetadata({
          title: '지난 밤 철강 뉴스',
          artist: document.querySelector('header .meta') ? document.querySelector('header .meta').textContent : '',
          album: '진흥철강 조간 브리핑'
        });
        navigator.mediaSession.setActionHandler('play', function () { started = true; audio.play(); });
        navigator.mediaSession.setActionHandler('pause', function () { audio.pause(); });
        navigator.mediaSession.setActionHandler('seekbackward', function () { audio.currentTime = Math.max(0, audio.currentTime - 15); });
        navigator.mediaSession.setActionHandler('seekforward', function () { audio.currentTime = audio.currentTime + 15; });
      } catch (e) { /* 미지원 브라우저는 무시 */ }
    }

    audio.addEventListener('loadedmetadata', function () {
      if (elHint) elHint.textContent = '전체 ' + mmss(audio.duration);
    });
    if (elHint) elHint.textContent = '전체 ' + mmss(chapters[chapters.length - 1].end);
    render();
  }

  // ══════════════════════════════════════════════════════
  //  2순위 — 브라우저 내장 음성 (MP3가 없을 때)
  // ══════════════════════════════════════════════════════
  function initSpeechMode() {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      elPlay.disabled = true;
      elPlay.textContent = '음성 재생 미지원 브라우저';
      if (elPanel) elPanel.hidden = true;
      return;
    }
    var synth = window.speechSynthesis;

    var MAX = 180;
    function split(text) {
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
      split(seg.text).forEach(function (s) { chunks.push({ text: s, seg: si }); });
    });
    function rangeOf(group) {
      for (var i = 0; i < chunks.length; i++) {
        if (segments[chunks[i].seg].group === group) return i;
      }
      return -1;
    }

    var voice = null;
    function pickVoice() {
      var ko = (synth.getVoices() || []).filter(function (v) { return /^ko/i.test(v.lang); });
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

    var idx = 0, startAt = 0, playing = false, paused = false, rate = 1.0;
    var watchdog = null, warmed = false, preparing = false, pending = null, wakeLock = null;

    function warmUp() {
      try {
        var w = new SpeechSynthesisUtterance('음성 안내를 준비하고 있습니다');
        w.lang = 'ko-KR'; if (voice) w.voice = voice; w.volume = 0;
        synth.speak(w);
      } catch (e) {}
    }
    function clearPending() { if (pending) { clearTimeout(pending); pending = null; } preparing = false; }
    function lockOn() {
      if (!('wakeLock' in navigator) || wakeLock) return;
      try {
        navigator.wakeLock.request('screen').then(function (l) {
          wakeLock = l; l.addEventListener('release', function () { wakeLock = null; });
        })['catch'](function () {});
      } catch (e) {}
    }
    function lockOff() { if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; } }

    function render() {
      setButtons(playing, paused);
      if (!playing) return;
      var seg = segments[chunks[Math.min(idx, chunks.length - 1)].seg];
      var pct = ((idx - startAt) / Math.max(1, chunks.length - startAt)) * 100;
      paint(seg.group, seg.label, pct,
            paused ? '일시정지' : (preparing ? '잠시 후 시작' : null));
    }
    function startWatchdog() {
      stopWatchdog();
      watchdog = setInterval(function () {
        if (playing && !paused && !preparing && !synth.speaking) next();
      }, 1200);
    }
    function stopWatchdog() { if (watchdog) { clearInterval(watchdog); watchdog = null; } }

    function next() {
      if (!playing || paused) return;
      if (idx >= chunks.length) { stop(); return; }
      var u = new SpeechSynthesisUtterance(chunks[idx].text);
      u.lang = 'ko-KR'; if (voice) u.voice = voice; u.rate = rate; u.pitch = 1.0;
      u.onend = function () { if (!playing || paused) return; idx += 1; render(); next(); };
      u.onerror = function (ev) {
        if (ev && (ev.error === 'canceled' || ev.error === 'interrupted')) return;
        idx += 1; if (playing && !paused) next();
      };
      synth.speak(u);
      render();
    }
    function play(from) {
      synth.cancel(); clearPending();
      startAt = from; idx = from; playing = true; paused = false;
      lockOn();
      var delay = warmed ? 300 : 1000;
      preparing = true;
      if (!warmed) warmUp();
      render();
      pending = setTimeout(function () {
        pending = null; preparing = false; warmed = true;
        if (!playing || paused) return;
        synth.cancel(); startWatchdog(); next();
      }, delay);
    }
    function stop() {
      playing = false; paused = false; clearPending();
      idx = startAt; synth.cancel(); stopWatchdog(); lockOff(); render();
    }

    elPlay.addEventListener('click', function () { if (!playing) play(0); });
    if (elPause) elPause.addEventListener('click', function () {
      if (!playing) return;
      if (paused) { paused = false; lockOn(); startWatchdog(); next(); render(); }
      else { paused = true; clearPending(); synth.cancel(); stopWatchdog(); lockOff(); render(); }
    });
    elStop.addEventListener('click', stop);
    elRate.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('button[data-rate]') : null;
      if (!btn) return;
      rate = parseFloat(btn.getAttribute('data-rate'));
      Array.prototype.forEach.call(elRate.querySelectorAll('button'), function (b) {
        b.classList.toggle('is-on', b === btn);
      });
      if (playing && !paused) { synth.cancel(); next(); }
    });
    if (elSecs) elSecs.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('button[data-group]') : null;
      if (!btn) return;
      var i = rangeOf(btn.getAttribute('data-group'));
      if (i >= 0) play(i);
    });
    window.addEventListener('beforeunload', function () { synth.cancel(); });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && playing && !paused) lockOn();
    });

    var total = segments.reduce(function (a, s) { return a + s.text.length; }, 0);
    if (elHint) elHint.textContent = '전체 약 ' + Math.max(1, Math.round(total / 330)) + '분';
    render();
  }

  // ── MP3가 있으면 그쪽, 없으면 브라우저 음성 ─────────────
  var done = false;
  function fallback() { if (!done) { done = true; initSpeechMode(); } }

  if (window.fetch) {
    fetch('chapters.json?v=' + VER, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (ch) {
        if (!ch || !ch.length) throw 0;
        // 실제로 재생 가능한지까지 확인한 뒤 확정한다
        var probe = new Audio('audio.mp3?v=' + VER);
        probe.preload = 'metadata';
        var settled = false;
        probe.addEventListener('loadedmetadata', function () {
          if (settled) return; settled = true;
          if (!done) { done = true; initAudioMode(ch); }
        });
        probe.addEventListener('error', function () {
          if (settled) return; settled = true; fallback();
        });
        setTimeout(function () { if (!settled) { settled = true; fallback(); } }, 6000);
      })
      ['catch'](fallback);
  } else {
    fallback();
  }
})();
