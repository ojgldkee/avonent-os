import threading
from datetime import datetime
from sqlalchemy import select
from .db import SessionLocal
from .models import Product, ResearchJob
from .research import run_creative_research
from .config import settings

_started = False
_lock = threading.Lock()


def scheduled_research_scan():
    db = SessionLocal()
    try:
        products = db.scalars(select(Product)).all()
        for product in products:
            active = db.scalar(select(ResearchJob).where(
                ResearchJob.product_id == product.id,
                ResearchJob.kind == "scheduled_creative_research",
                ResearchJob.status.in_(["queued", "running"]),
            ))
            if active:
                continue
            job = ResearchJob(product_id=product.id, kind="scheduled_creative_research", status="queued", created_at=datetime.utcnow())
            db.add(job)
            db.commit()
            db.refresh(job)
            run_creative_research(db, job)
    finally:
        db.close()


def _loop():
    interval = max(15, settings.research_interval_minutes) * 60
    while True:
        threading.Event().wait(interval)
        try:
            scheduled_research_scan()
        except Exception:
            pass


def start_scheduler():
    global _started
    with _lock:
        if _started:
            return
        thread = threading.Thread(target=_loop, name="avonent-research-worker", daemon=True)
        thread.start()
        _started = True
