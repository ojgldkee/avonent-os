from datetime import datetime
from sqlalchemy.orm import Session
from .ai import generate_creative
from .models import Creative, ResearchJob


def run_creative_research(db: Session, job: ResearchJob, created_by_user_id: int | None = None):
    job.status = "running"
    db.commit()
    product = job.product
    try:
        concept = generate_creative(product.name, product.category, product.notes)
        creative = Creative(
            product_id=product.id,
            created_by_user_id=created_by_user_id,
            title=concept.get("title", f"{product.name} concept"),
            angle=concept.get("angle", ""),
            format=concept.get("format", "video"),
            hook=concept.get("hook", ""),
            script=concept.get("script", ""),
            primary_text=concept.get("primary_text", ""),
            headline=concept.get("headline", ""),
            status="idea",
        )
        db.add(creative)
        db.flush()
        job.status = "completed"
        job.summary = f"Generated creative concept #{creative.id} for {product.name}. External competitor-source collection is not enabled until an authorized source adapter is configured."
        job.source_notes = "No competitor performance claims were inferred."
        job.completed_at = datetime.utcnow()
        db.commit()
    except Exception as exc:
        job.status = "failed"
        job.summary = str(exc)[:2000]
        job.completed_at = datetime.utcnow()
        db.commit()
        raise
