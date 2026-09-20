# -*- coding: utf-8 -*-
"""ESP32 등 단순 HTTP 클라이언트용 평문 카운터 파일을 만든다.

abacus(외부 카운터)에서 '오늘 방문 수'와 '오늘 음성 재생 수'를 읽어
log/<고정 난수 이름>.json 에 숫자만 기록한다.

출력 형식(이 네 필드 외에는 절대 넣지 않는다):
    {"ok":true,"today":42,"plays":17,"ts":1758300000}

개인정보는 어떤 경로로도 들어오지 않는다. abacus는 정수 하나만 돌려주며
이 스크립트는 IP·User-Agent·접속 기록을 읽지도 저장하지도 않는다.
"""
import io, json, os, sys, time
import urllib.request, urllib.error
from datetime import datetime, timedelta, timezone

NS = "steelbrief-ds1bkf-live"          # tracker.js와 동일한 네임스페이스
OUT = "log/ad8a78f70dfa3cae4dd28b92.json"

# 읽기 전용 엔드포인트. /hit/ 은 호출할 때마다 카운터를 1 올리므로
# 이 스크립트에서는 어떤 경우에도 쓰지 않는다. 쓰면 통계가 망가진다.
GET = "https://abacus.jasoncameron.dev/get/%s/%s"

HEARTBEAT = 3600       # 숫자가 그대로여도 이 간격(초)마다 한 번은 ts를 갱신한다
TIMEOUT = 15
RETRIES = 3
BACKOFF = (2, 5, 10)


def kst_today() -> str:
    """tracker.js와 같은 KST 기준 날짜 키(YYYY-MM-DD)."""
    return datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d")


def fetch_count(key: str) -> int:
    """카운터 값을 읽는다. 키가 아직 없으면(404) 0으로 본다."""
    url = GET % (NS, key)
    for i in range(RETRIES + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "steel-briefing-device-json"})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                v = json.load(r).get("value", 0)
            return max(0, int(v))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return 0                      # 그날 첫 방문 전에는 키가 없다
            if not (e.code == 429 or 500 <= e.code < 600) or i == RETRIES:
                raise
        except Exception:
            if i == RETRIES:
                raise
        time.sleep(BACKOFF[min(i, len(BACKOFF) - 1)])
    return 0


def read_prev(path: str):
    try:
        with io.open(path, encoding="utf-8") as f:
            d = json.load(f)
        return int(d.get("today", -1)), int(d.get("plays", -1)), int(d.get("ts", 0))
    except Exception:
        return None


def main() -> int:
    day = kst_today()
    try:
        today = fetch_count("d-" + day)
        plays = fetch_count("play-d-" + day)
    except Exception as e:
        # abacus가 죽어도 기존 파일을 망가뜨리지 않는다. 기기는 ts로 오래됨을 안다.
        print("카운터 조회 실패(%s: %s) — 기존 파일 유지" % (type(e).__name__, e))
        return 0

    now = int(time.time())
    prev = read_prev(OUT)
    if prev is not None:
        p_today, p_plays, p_ts = prev
        if p_today == today and p_plays == plays and (now - p_ts) < HEARTBEAT:
            print("변경 없음 (today=%d plays=%d, %d초 전 기록) — 쓰기 생략" % (today, plays, now - p_ts))
            return 0

    payload = {"ok": True, "today": today, "plays": plays, "ts": now}
    # 공백 없이 직렬화해야 200바이트 제한에 여유가 생긴다
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)

    assert set(payload) == {"ok", "today", "plays", "ts"}, "허용되지 않은 필드"
    assert len(body.encode("utf-8")) <= 200, "200바이트 초과"

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with io.open(OUT, "w", encoding="utf-8", newline="") as f:
        f.write(body)
    print("기록: %s (%d바이트) %s" % (body, len(body.encode("utf-8")), OUT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
