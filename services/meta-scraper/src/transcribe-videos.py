import json, os, sys, tempfile, urllib.parse, urllib.request, subprocess
from datetime import datetime, timezone
from faster_whisper import WhisperModel

SUPABASE_URL=os.environ["SUPABASE_URL"].rstrip("/")
SERVICE_KEY=os.environ["SUPABASE_SERVICE_ROLE_KEY"]
COMPETITOR_ID=os.environ.get("COMPETITOR_ID","").strip()
MAX_VIDEOS=max(1,min(int(os.environ.get("MAX_TRANSCRIPTS_PER_RUN","8")),12))
MODEL_NAME=os.environ.get("WHISPER_MODEL","small.en")

HEADERS={
    "apikey":SERVICE_KEY,
    "authorization":"Bearer "+SERVICE_KEY,
    "content-type":"application/json",
    "user-agent":"Mozilla/5.0 AvonentResearch/1.0"
}

def rest(path, method="GET", body=None):
    req=urllib.request.Request(
        SUPABASE_URL+"/rest/v1/"+path,
        method=method,
        headers=HEADERS,
        data=None if body is None else json.dumps(body).encode("utf-8")
    )
    with urllib.request.urlopen(req, timeout=60) as res:
        data=res.read()
        return json.loads(data) if data else None

def patch(ad_id, body):
    path="competitor_ads?id=eq."+urllib.parse.quote(ad_id)
    req=urllib.request.Request(
        SUPABASE_URL+"/rest/v1/"+path,
        method="PATCH",
        headers={**HEADERS,"Prefer":"return=minimal"},
        data=json.dumps(body).encode("utf-8")
    )
    with urllib.request.urlopen(req, timeout=60) as res:
        res.read()

def download(url, out_path):
    req=urllib.request.Request(url,headers={
        "user-agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/136 Safari/537.36",
        "referer":"https://www.facebook.com/"
    })
    with urllib.request.urlopen(req,timeout=90) as res, open(out_path,"wb") as f:
        total=0
        while True:
            chunk=res.read(1024*1024)
            if not chunk: break
            total+=len(chunk)
            if total>120*1024*1024:
                raise RuntimeError("video is larger than 120 MB")
            f.write(chunk)

def duration(path):
    p=subprocess.run(["ffprobe","-v","error","-show_entries","format=duration","-of","default=nw=1:nk=1",path],capture_output=True,text=True,timeout=30)
    try:return round(float(p.stdout.strip()),2)
    except:return None

query="competitor_ads?select=id,ad_archive_id,advertiser_name,competitor_id,media_url,media_kind,days_running,video_transcript,transcription_status,transcribed_at&media_kind=eq.video&media_url=not.is.null&order=days_running.desc&limit=40"
if COMPETITOR_ID:
    query+="&competitor_id=eq."+urllib.parse.quote(COMPETITOR_ID)
rows=rest(query) or []
rows=[r for r in rows if r.get("media_url") and not (r.get("video_transcript") or "").strip()][:MAX_VIDEOS]
if not rows:
    print("No untranscribed competitor videos in this run.")
    sys.exit(0)

print(f"Loading Whisper model {MODEL_NAME} for {len(rows)} video(s).")
model=WhisperModel(MODEL_NAME,device="cpu",compute_type="int8",cpu_threads=max(2,os.cpu_count() or 2))

ok=0
for ad in rows:
    ad_id=ad["id"]
    archive=ad.get("ad_archive_id","")
    print(f"[{archive}] transcribing {ad.get('advertiser_name','')}")
    patch(ad_id,{"transcription_status":"running","transcription_error":None})
    try:
        with tempfile.TemporaryDirectory() as td:
            video=os.path.join(td,"ad.mp4")
            download(ad["media_url"],video)
            dur=duration(video)
            segments,info=model.transcribe(
                video,
                language="en",
                beam_size=5,
                vad_filter=True,
                word_timestamps=False,
                condition_on_previous_text=True
            )
            out=[]
            full=[]
            for s in segments:
                text=(s.text or "").strip()
                if not text: continue
                item={"start":round(float(s.start),2),"end":round(float(s.end),2),"text":text}
                out.append(item)
                full.append(text)
            transcript=" ".join(full).strip()
            if not transcript:
                raise RuntimeError("no speech detected")
            patch(ad_id,{
                "video_transcript":transcript[:30000],
                "video_transcript_segments":out[:250],
                "video_duration_seconds":dur,
                "transcription_status":"complete",
                "transcription_model":"faster-whisper/"+MODEL_NAME,
                "transcribed_at":datetime.now(timezone.utc).isoformat(),
                "transcription_error":None,
                "analyzed_at":None
            })
            print(f"[{archive}] {len(out)} segments, {len(transcript)} chars")
            ok+=1
    except Exception as e:
        message=str(e)[:800]
        print(f"[{archive}] transcription failed: {message}",file=sys.stderr)
        patch(ad_id,{
            "transcription_status":"error",
            "transcription_error":message,
            "transcribed_at":datetime.now(timezone.utc).isoformat()
        })

print(f"Transcribed {ok}/{len(rows)} video(s).")
