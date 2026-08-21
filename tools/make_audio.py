# -*- coding: utf-8 -*-
"""index.html의 낭독 대본을 구글 Text-to-Speech로 합성해 audio.mp3와 chapters.json을 만든다.
   단락별로 따로 합성해 길이를 재고 이어 붙이므로, 각 단락의 시작·끝 시각을 정확히 알 수 있다."""
import base64, io, json, os, re, subprocess, sys, tempfile
import urllib.request, urllib.parse

VOICE = os.environ.get("TTS_VOICE", "ko-KR-Chirp3-HD-Despina")
RATE = float(os.environ.get("TTS_RATE", "1.08"))
GAP = {"intro": 0.35, "weather": 0.3, "global": 0.3, "steel": 0.3, "domestic": 0.3, "outro": 0.35}
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


def synthesize(text: str, token: str) -> bytes:
    payload = {
        "input": {"text": text},
        "voice": {"languageCode": "ko-KR", "name": VOICE},
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
    print("음성: %s / 속도 %.2f / 단락 %d개" % (VOICE, RATE, len(segs)))

    tmp = tempfile.mkdtemp()
    parts, chapters, t = [], [], 0.0
    total_chars = 0

    for i, seg in enumerate(segs):
        text = seg["text"].strip()
        total_chars += len(text)
        p = os.path.join(tmp, "%02d.mp3" % i)
        with open(p, "wb") as f:
            f.write(synthesize(text, token))
        d = duration(p)
        gap = GAP.get(seg.get("group"), 0.5)
        chapters.append({"group": seg.get("group", ""), "label": seg.get("label", ""),
                         "start": round(t, 2), "end": round(t + d, 2)})
        t += d + gap
        parts.append((p, gap))
        print("  %2d. %-24s %6.1f초  (%s)" % (i + 1, seg.get("label", "")[:24], d, seg.get("group")))

    # 단락 사이에 무음을 끼워 이어 붙인다
    silence = os.path.join(tmp, "sil.mp3")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-t", "1.0",
                    "-i", "anullsrc=r=24000:cl=mono", silence], check=True)
    listfile = os.path.join(tmp, "list.txt")
    with io.open(listfile, "w", encoding="utf-8") as f:
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
