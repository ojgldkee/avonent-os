from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from uuid import uuid4

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from .auth import (
    audit,
    clear_session_cookie,
    create_session,
    get_auth_context,
    hash_password,
    normalize_email,
    random_token,
    require_auth,
    require_role,
    revoke_current_session,
    set_session_cookie,
    token_hash,
    validate_password,
    verify_csrf,
    verify_password,
)
from .config import settings
from .db import Base, engine, get_db
from .models import Asset, Brand, Creative, Invite, Product, ResearchJob, User
from .research import run_creative_research
from .scheduler import start_scheduler

BASE_DIR = Path(__file__).resolve().parent
Path(settings.storage_path).mkdir(parents=True, exist_ok=True)

ALLOWED_ROLES = {"owner", "admin", "editor", "viewer"}
EDIT_ROLES = {"owner", "admin", "editor"}
ADMIN_ROLES = {"owner", "admin"}
ALLOWED_UPLOAD_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".webp", ".gif",
    ".mp4", ".mov", ".m4v", ".webm",
    ".pdf", ".txt", ".md", ".docx",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    start_scheduler()
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan, docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=BASE_DIR / "templates")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
    if settings.hsts_enabled and request.url.scheme == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


def render(request: Request, name: str, context: dict, status_code: int = 200):
    context = {"request": request, **context}
    return templates.TemplateResponse(name, context, status_code=status_code)


def double_submit_csrf_response(request: Request, template: str, context: dict):
    token = random_token()
    response = render(request, template, {**context, "csrf_token": token})
    response.set_cookie("avonent_form_csrf", token, httponly=False, secure=settings.cookie_secure, samesite="strict", max_age=1800, path="/")
    return response


def verify_double_submit_csrf(request: Request, submitted: str):
    cookie = request.cookies.get("avonent_form_csrf", "")
    if not submitted or not cookie or token_hash(submitted) != token_hash(cookie):
        raise HTTPException(status_code=403, detail="Invalid security token. Refresh and try again.")


@app.get("/health")
def health():
    return {"ok": True, "service": settings.app_name}


@app.get("/setup", response_class=HTMLResponse)
def setup_page(request: Request, db: Session = Depends(get_db)):
    if db.scalar(select(func.count(User.id))) > 0:
        return RedirectResponse("/login", status_code=303)
    return double_submit_csrf_response(request, "setup.html", {"error": ""})


@app.post("/setup")
def setup_owner(
    request: Request,
    display_name: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    password_confirm: str = Form(...),
    setup_code: str = Form(""),
    csrf_token: str = Form(...),
    db: Session = Depends(get_db),
):
    verify_double_submit_csrf(request, csrf_token)
    if settings.environment == "production" and not settings.owner_setup_token:
        raise HTTPException(503, "OWNER_SETUP_TOKEN must be configured before first-run setup.")
    if settings.owner_setup_token and token_hash(setup_code) != token_hash(settings.owner_setup_token):
        return double_submit_csrf_response(request, "setup.html", {"error": "Setup code is incorrect."})
    if db.scalar(select(func.count(User.id))) > 0:
        raise HTTPException(409, "Owner account already exists.")
    if password != password_confirm:
        return double_submit_csrf_response(request, "setup.html", {"error": "Passwords do not match."})
    password_error = validate_password(password)
    if password_error:
        return double_submit_csrf_response(request, "setup.html", {"error": password_error})
    email = normalize_email(email)
    user = User(email=email, display_name=display_name.strip()[:120], password_hash=hash_password(password), role="owner")
    db.add(user)
    db.flush()
    audit(db, request, "owner_created", user_id=user.id, object_type="user", object_id=user.id)
    db.commit()
    token, _ = create_session(db, request, user)
    response = RedirectResponse("/", status_code=303)
    set_session_cookie(response, token)
    response.delete_cookie("avonent_form_csrf", path="/")
    return response


@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request, db: Session = Depends(get_db)):
    if db.scalar(select(func.count(User.id))) == 0:
        return RedirectResponse("/setup", status_code=303)
    if get_auth_context(request, db):
        return RedirectResponse("/", status_code=303)
    return double_submit_csrf_response(request, "login.html", {"error": ""})


@app.post("/login")
def login(
    request: Request,
    email: str = Form(...),
    password: str = Form(...),
    csrf_token: str = Form(...),
    db: Session = Depends(get_db),
):
    verify_double_submit_csrf(request, csrf_token)
    now = datetime.utcnow()
    email = normalize_email(email)
    user = db.scalar(select(User).where(User.email == email))
    generic_error = "Email or password is incorrect."
    if not user or not user.is_active:
        return double_submit_csrf_response(request, "login.html", {"error": generic_error})
    if user.locked_until and user.locked_until > now:
        return double_submit_csrf_response(request, "login.html", {"error": "Too many failed attempts. Try again later."})
    if not verify_password(user.password_hash, password):
        user.failed_logins += 1
        if user.failed_logins >= 5:
            user.locked_until = now + timedelta(minutes=15)
            user.failed_logins = 0
        audit(db, request, "login_failed", user_id=user.id, object_type="user", object_id=user.id)
        db.commit()
        return double_submit_csrf_response(request, "login.html", {"error": generic_error})

    user.failed_logins = 0
    user.locked_until = None
    user.last_login_at = now
    audit(db, request, "login_success", user_id=user.id, object_type="user", object_id=user.id)
    db.commit()
    token, _ = create_session(db, request, user)
    response = RedirectResponse("/", status_code=303)
    set_session_cookie(response, token)
    response.delete_cookie("avonent_form_csrf", path="/")
    return response


@app.post("/logout")
def logout(request: Request, csrf_token: str = Form(...), db: Session = Depends(get_db)):
    auth = require_auth(request, db)
    verify_csrf(auth, csrf_token)
    audit(db, request, "logout", user_id=auth.user.id)
    db.commit()
    revoke_current_session(db, auth)
    response = RedirectResponse("/login", status_code=303)
    clear_session_cookie(response)
    return response


@app.get("/join/{invite_token}", response_class=HTMLResponse)
def join_page(invite_token: str, request: Request, db: Session = Depends(get_db)):
    invite = db.scalar(select(Invite).where(Invite.token_hash == token_hash(invite_token)))
    if not invite or invite.used_at or invite.expires_at <= datetime.utcnow():
        raise HTTPException(404, "Invite is invalid or expired.")
    return double_submit_csrf_response(request, "join.html", {"invite": invite, "invite_token": invite_token, "error": ""})


@app.post("/join/{invite_token}")
def join_team(
    invite_token: str,
    request: Request,
    display_name: str = Form(...),
    password: str = Form(...),
    password_confirm: str = Form(...),
    csrf_token: str = Form(...),
    db: Session = Depends(get_db),
):
    verify_double_submit_csrf(request, csrf_token)
    invite = db.scalar(select(Invite).where(Invite.token_hash == token_hash(invite_token)))
    if not invite or invite.used_at or invite.expires_at <= datetime.utcnow():
        raise HTTPException(404, "Invite is invalid or expired.")
    if db.scalar(select(User).where(User.email == invite.email)):
        raise HTTPException(409, "An account already exists for this email.")
    if password != password_confirm:
        return double_submit_csrf_response(request, "join.html", {"invite": invite, "invite_token": invite_token, "error": "Passwords do not match."})
    password_error = validate_password(password)
    if password_error:
        return double_submit_csrf_response(request, "join.html", {"invite": invite, "invite_token": invite_token, "error": password_error})
    user = User(email=invite.email, display_name=display_name.strip()[:120], password_hash=hash_password(password), role=invite.role)
    db.add(user)
    db.flush()
    invite.used_at = datetime.utcnow()
    audit(db, request, "invite_accepted", user_id=user.id, object_type="invite", object_id=invite.id, details=f"role={invite.role}")
    db.commit()
    token, _ = create_session(db, request, user)
    response = RedirectResponse("/", status_code=303)
    set_session_cookie(response, token)
    response.delete_cookie("avonent_form_csrf", path="/")
    return response


@app.get("/", response_class=HTMLResponse)
def dashboard(request: Request, db: Session = Depends(get_db)):
    auth = require_auth(request, db)
    brands = db.scalars(select(Brand).options(selectinload(Brand.products).selectinload(Product.assets))).all()
    jobs = db.scalars(select(ResearchJob).order_by(ResearchJob.created_at.desc()).limit(10)).all()
    creatives = db.scalars(select(Creative).options(selectinload(Creative.product)).order_by(Creative.created_at.desc()).limit(20)).all()
    products = db.scalars(select(Product).order_by(Product.created_at.desc())).all()
    return render(request, "dashboard.html", {
        "auth": auth,
        "brands": brands,
        "products": products,
        "jobs": jobs,
        "creatives": creatives,
        "can_edit": auth.user.role in EDIT_ROLES,
        "can_admin": auth.user.role in ADMIN_ROLES,
    })


@app.get("/team", response_class=HTMLResponse)
def team(request: Request, db: Session = Depends(get_db)):
    auth = require_auth(request, db)
    require_role(auth, ADMIN_ROLES)
    users = db.scalars(select(User).order_by(User.created_at.asc())).all()
    invites = db.scalars(select(Invite).order_by(Invite.created_at.desc()).limit(20)).all()
    return render(request, "team.html", {"auth": auth, "users": users, "invites": invites, "invite_link": ""})


@app.post("/team/invites", response_class=HTMLResponse)
def create_invite(
    request: Request,
    email: str = Form(...),
    role: str = Form("editor"),
    csrf_token: str = Form(...),
    db: Session = Depends(get_db),
):
    auth = require_auth(request, db)
    require_role(auth, ADMIN_ROLES)
    verify_csrf(auth, csrf_token)
    email = normalize_email(email)
    if role not in {"admin", "editor", "viewer"}:
        raise HTTPException(400, "Invalid role.")
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "That email already has an account.")
    token = random_token()
    invite = Invite(
        email=email,
        role=role,
        token_hash=token_hash(token),
        created_by_user_id=auth.user.id,
        expires_at=datetime.utcnow() + timedelta(days=7),
    )
    db.add(invite)
    db.flush()
    audit(db, request, "invite_created", user_id=auth.user.id, object_type="invite", object_id=invite.id, details=f"role={role}")
    db.commit()
    users = db.scalars(select(User).order_by(User.created_at.asc())).all()
    invites = db.scalars(select(Invite).order_by(Invite.created_at.desc()).limit(20)).all()
    invite_link = str(request.base_url).rstrip("/") + f"/join/{token}"
    return render(request, "team.html", {"auth": auth, "users": users, "invites": invites, "invite_link": invite_link})


@app.post("/brands")
def create_brand(request: Request, name: str = Form(...), csrf_token: str = Form(...), db: Session = Depends(get_db)):
    auth = require_auth(request, db)
    require_role(auth, ADMIN_ROLES)
    verify_csrf(auth, csrf_token)
    existing = db.scalar(select(Brand).where(Brand.name == name.strip()))
    if not existing:
        brand = Brand(name=name.strip()[:120])
        db.add(brand)
        db.flush()
        audit(db, request, "brand_created", auth.user.id, "brand", brand.id)
        db.commit()
    return RedirectResponse("/", status_code=303)


@app.post("/products")
def create_product(
    request: Request,
    brand_id: int = Form(...),
    name: str = Form(...),
    category: str = Form(""),
    price: float | None = Form(None),
    notes: str = Form(""),
    csrf_token: str = Form(...),
    db: Session = Depends(get_db),
):
    auth = require_auth(request, db)
    require_role(auth, ADMIN_ROLES)
    verify_csrf(auth, csrf_token)
    if not db.get(Brand, brand_id):
        raise HTTPException(404, "Brand not found")
    product = Product(brand_id=brand_id, name=name.strip()[:160], category=category.strip()[:120], price=price, notes=notes.strip())
    db.add(product)
    db.flush()
    audit(db, request, "product_created", auth.user.id, "product", product.id)
    db.commit()
    return RedirectResponse("/", status_code=303)


@app.post("/creatives/manual")
def create_manual_creative(
    request: Request,
    product_id: int = Form(...),
    title: str = Form(...),
    angle: str = Form(""),
    format: str = Form("video"),
    hook: str = Form(""),
    script: str = Form(""),
    primary_text: str = Form(""),
    headline: str = Form(""),
    csrf_token: str = Form(...),
    db: Session = Depends(get_db),
):
    auth = require_auth(request, db)
    require_role(auth, EDIT_ROLES)
    verify_csrf(auth, csrf_token)
    if not db.get(Product, product_id):
        raise HTTPException(404, "Product not found")
    creative = Creative(
        product_id=product_id,
        created_by_user_id=auth.user.id,
        title=title.strip()[:180],
        angle=angle.strip()[:180],
        format=format.strip()[:80],
        hook=hook.strip(),
        script=script.strip(),
        primary_text=primary_text.strip(),
        headline=headline.strip()[:240],
        status="idea",
    )
    db.add(creative)
    db.flush()
    audit(db, request, "creative_created", auth.user.id, "creative", creative.id)
    db.commit()
    return RedirectResponse("/", status_code=303)


@app.post("/products/{product_id}/research")
def start_research(product_id: int, request: Request, csrf_token: str = Form(...), db: Session = Depends(get_db)):
    auth = require_auth(request, db)
    require_role(auth, EDIT_ROLES)
    verify_csrf(auth, csrf_token)
    if not db.get(Product, product_id):
        raise HTTPException(404, "Product not found")
    job = ResearchJob(product_id=product_id, status="queued")
    db.add(job)
    db.commit()
    db.refresh(job)
    run_creative_research(db, job, created_by_user_id=auth.user.id)
    audit(db, request, "creative_research_run", auth.user.id, "research_job", job.id)
    db.commit()
    return RedirectResponse("/", status_code=303)


@app.post("/creatives/{creative_id}/status")
def update_creative_status(creative_id: int, request: Request, status: str = Form(...), csrf_token: str = Form(...), db: Session = Depends(get_db)):
    auth = require_auth(request, db)
    require_role(auth, EDIT_ROLES)
    verify_csrf(auth, csrf_token)
    allowed = {"idea", "research", "brief", "editing", "review", "approved", "launched", "winner", "loser", "retest"}
    if status not in allowed:
        raise HTTPException(400, "Invalid creative status")
    creative = db.get(Creative, creative_id)
    if not creative:
        raise HTTPException(404, "Creative not found")
    creative.status = status
    audit(db, request, "creative_status_changed", auth.user.id, "creative", creative.id, details=f"status={status}")
    db.commit()
    return RedirectResponse("/", status_code=303)


@app.post("/products/{product_id}/assets")
async def upload_asset(product_id: int, request: Request, csrf_token: str = Form(...), file: UploadFile = File(...), db: Session = Depends(get_db)):
    auth = require_auth(request, db)
    require_role(auth, EDIT_ROLES)
    verify_csrf(auth, csrf_token)
    if not db.get(Brand, db.get(Product, product_id).brand_id) if db.get(Product, product_id) else True:
        raise HTTPException(404, "Product not found")
    original_name = Path(file.filename or "upload.bin").name[:255]
    suffix = Path(original_name).suffix.lower()
    if suffix not in ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(400, "This file type is not allowed.")
    max_bytes = settings.max_upload_mb * 1024 * 1024
    data = await file.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise HTTPException(413, f"File is larger than {settings.max_upload_mb} MB.")
    stored_name = f"{uuid4().hex}{suffix}"
    target_dir = Path(settings.storage_path) / f"product-{product_id}"
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / stored_name
    target.write_bytes(data)
    asset = Asset(
        product_id=product_id,
        uploaded_by_user_id=auth.user.id,
        original_name=original_name,
        stored_name=stored_name,
        mime_type=(file.content_type or "application/octet-stream")[:160],
        size_bytes=len(data),
    )
    db.add(asset)
    db.flush()
    audit(db, request, "asset_uploaded", auth.user.id, "asset", asset.id, details=original_name)
    db.commit()
    return RedirectResponse("/", status_code=303)


@app.get("/assets/{asset_id}")
def view_asset(asset_id: int, request: Request, db: Session = Depends(get_db)):
    require_auth(request, db)
    asset = db.get(Asset, asset_id)
    if not asset:
        raise HTTPException(404, "Asset not found")
    target = Path(settings.storage_path) / f"product-{asset.product_id}" / asset.stored_name
    if not target.is_file():
        raise HTTPException(404, "Asset file missing")
    return FileResponse(target, media_type=asset.mime_type, filename=asset.original_name, content_disposition_type="inline", headers={"Cache-Control": "private, max-age=300"})
