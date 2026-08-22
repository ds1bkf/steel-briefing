# -*- coding: utf-8 -*-
"""index.html의 낭독 대본을 구글 Text-to-Speech로 합성해 audio.mp3와 chapters.json을 만든다.
   단락별로 따로 합성해 길이를 재고 이어 붙이므로, 각 단락의 시작·끝 시각을 정확히 알 수 있다."""
import base64, io, json, os, re, subprocess, sys, tempfile
import urllib.request, urllib.parse

# 섹터별 화자 — 라디오 뉴스처럼 진행자와 리포터를 나눈다.
# 진행자(Kore)가 열고 닫으며 날씨·배차를 맡고, 섹터마다 리포터가 바뀐다.
VOICE_BY_GROUP = {
    "intro":    "ko-KR-Chirp3-HD-Sulafat",    # 진행자(여)
    "weather":  "ko-KR-Chirp3-HD-Sulafat",    # 진행자(여)
    "global":   "ko-KR-Chirp3-HD-Orus",       # 세계(남)
    "steel":    "ko-KR-Chirp3-HD-Leda",       # 철강(여)
    "domestic": "ko-KR-Chirp3-HD-Enceladus",  # 국내(남)
    "outro":    "ko-KR-Chirp3-HD-Sulafat",    # 진행자(여) — 오프닝과 동일
}
VOICE_FALLBACK = os.environ.get("TTS_VOICE", "ko-KR-Chirp3-HD-Sulafat")
RATE = float(os.environ.get("TTS_RATE", "1.08"))
LEAD_IN = 1.0        # 도입부 무음(초)
GAP_PARA = 0.5       # 주제와 주제 사이
GAP_SECTION = 1.0    # 섹터가 바뀔 때
API = "https://texttospeech.googleapis.com/v1/text:synthesize"


def access_token(sa: dict) -> str:
    """서비스 계정 JSON으로 OAuth 액세스 토큰을 받는다(외부 라이브러리 없이 처리)."""
    import time
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding

    def b64(d):
        return base64.urlsafe_b64encode(d).rstrip(b"=")

    now = int(time.time())
    header = b64(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
    claim = b64(json.dumps({
        "iss": sa["client_email"],
        "scope": "https://www.googleapis.com/auth/cloud-platform",
        "aud": "https://oauth2.googleapis.com/token",
        "iat": now, "exp": now + 3600,
    }).encode())
    signing_input = header + b"." + claim
    key = serialization.load_pem_private_key(sa["private_key"].encode(), password=None)
    sig = key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
    jwt = (signing_input + b"." + b64(sig)).decode()

    body = urllib.parse.urlencode({
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion": jwt,
    }).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body,
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["access_token"]


def synthesize(text: str, token: str, voice: str) -> bytes:
    payload = {
        "input": {"text": text},
        "voice": {"languageCode": "ko-KR", "name": voice},
        "audioConfig": {"audioEncoding": "MP3", "speakingRate": RATE},
    }
    req = urllib.request.Request(API, data=json.dumps(payload).encode(),
                                 headers={"Authorization": "Bearer " + token,
                                          "Content-Type": "application/json; charset=utf-8"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return base64.b64decode(json.load(r)["audioContent"])


def duration(path: str) -> float:
    out = subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", path])
    return float(out.strip())


def main():
    html = io.open("index.html", encoding="utf-8").read()
    m = re.search(r'<script type="application/json" id="tts-script">(.*?)</script>', html, re.S)
    if not m:
        print("대본 블록을 찾지 못했습니다."); sys.exit(1)
    segs = json.loads(m.group(1))
    if not segs:
        print("대본이 비어 있습니다."); sys.exit(1)

    sa = json.loads(os.environ["GCP_TTS_KEY"])
    token = access_token(sa)
    print("속도 %.2f / 단락 %d개 / 화자 %d명" % (RATE, len(segs), len(set(VOICE_BY_GROUP.values()))))
    for g, v in VOICE_BY_GROUP.items():
        print("   %-9s %s" % (g, v))

    tmp = tempfile.mkdtemp()
    parts, chapters, t = [], [], LEAD_IN   # 앞 무음만큼 밀려서 시작한다
    total_chars = 0

    for i, seg in enumerate(segs):
        text = seg["text"].strip()
        total_chars += len(text)
        voice = seg.get("voice") or VOICE_BY_GROUP.get(seg.get("group"), VOICE_FALLBACK)
        p = os.path.join(tmp, "%02d.mp3" % i)
        with open(p, "wb") as f:
            f.write(synthesize(text, token, voice))
        d = duration(p)
        nxt = segs[i + 1] if i + 1 < len(segs) else None
        gap = GAP_SECTION if (nxt and nxt.get("group") != seg.get("group")) else GAP_PARA
        chapters.append({"group": seg.get("group", ""), "label": seg.get("label", ""),
                         "start": round(t, 2), "end": round(t + d, 2)})
        t += d + gap
        parts.append((p, gap))
        print("  %2d. %-22s %6.1f초  %s" % (i + 1, seg.get("label", "")[:22], d, voice.split("-")[-1]))

    # 단락 사이에 무음을 끼워 이어 붙인다
    silence = os.path.join(tmp, "sil.mp3")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-t", "1.0",
                    "-i", "anullsrc=r=24000:cl=mono", silence], check=True)
    listfile = os.path.join(tmp, "list.txt")
    with io.open(listfile, "w", encoding="utf-8") as f:
        # 맨 앞 1초 무음: 재생을 누른 직후 오디오 장치가 깨어나며 첫 음절이 잘리는 것을 막는다
        f.write("file '%s'\noutpoint %.2f\n" % (silence, LEAD_IN))
        for idx, (p, gap) in enumerate(parts):
            f.write("file '%s'\n" % p)
            if idx < len(parts) - 1:
                f.write("file '%s'\noutpoint %.2f\n" % (silence, gap))
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
                    "-i", listfile, "-c:a", "libmp3lame", "-b:a", "64k", "-ac", "1",
                    "audio.mp3"], check=True)

    io.open("chapters.json", "w", encoding="utf-8").write(
        json.dumps(chapters, ensure_ascii=False, indent=0))

    size = os.path.getsize("audio.mp3") / 1048576.0
    print("\n생성 완료: audio.mp3 %.1fMB / 총 %.1f분 / %d자" % (size, t / 60, total_chars))
    print("chapters.json %d개 구간" % len(chapters))


if __name__ == "__main__":
    main()
