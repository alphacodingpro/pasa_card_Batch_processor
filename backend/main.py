import os
import re
import json
import asyncio
import urllib.parse
from fastapi import FastAPI, Depends, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel
from dotenv import load_dotenv
import httpx

from database import SessionLocal, engine, Base
from models import CardProcess

import time
from sqlalchemy.exc import OperationalError

# Database initialization is handled in the @app.on_event("startup") below.
load_dotenv()

app = FastAPI(title="PSA Scanner Backend")

# 1. CORS MUST BE FIRST
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# 2. Async Startup to avoid blocking health checks
@app.on_event("startup")
async def startup_event():
    def init_db():
        retries = 15
        while retries > 0:
            try:
                from database import engine, Base
                from models import CardProcess
                Base.metadata.create_all(bind=engine)
                print("✅ Database connected and tables created.")
                break
            except Exception as e:
                print(f"⏳ Waiting for DB DNS... ({retries} left). Error: {e}")
                retries -= 1
                time.sleep(6)
        else:
            print("❌ FATAL: Could not connect to the database after all retries.")
    import threading
    threading.Thread(target=init_db, daemon=True).start()

from fastapi.responses import JSONResponse
from fastapi.requests import Request

@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"error": str(exc), "detail": "Internal server error. Check backend logs."},
        headers={"Access-Control-Allow-Origin": "*"},
    )

@app.get("/")
def read_root():
    return {"status": "ok", "message": "PSA Scanner API is live", "timestamp": time.time()}

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

class ProcessRequest(BaseModel):
    barcode: str

# ─────────────────────────────────────────────
# TITLE CLEANER
# ─────────────────────────────────────────────
def clean_psa_title(raw: str) -> str:
    """Normalize PSA card title for accurate SerpAPI search."""
    if not raw:
        return ""
    c = raw.lower()
    c = re.sub(r'#[a-zA-Z0-9]+', '', c)      # Remove #GG50 style tokens
    c = re.sub(r'[\/\*\|\-\(\)\\]', ' ', c)  # Replace separators incl backslash
    c = re.sub(r'\s+', ' ', c).strip()
    return c

# ─────────────────────────────────────────────
# EBAY LINK GENERATOR
# ─────────────────────────────────────────────
def build_ebay_links(title: str, grade: str = "") -> dict:
    """Generate eBay search links for listings and sold items."""
    query = f"{title} PSA {grade}".strip() if grade else title
    encoded = urllib.parse.quote(query)
    return {
        "listings_url": f"https://www.ebay.com/sch/i.html?_nkw={encoded}&LH_ItemCondition=3000",
        "sold_url":     f"https://www.ebay.com/sch/i.html?_nkw={encoded}&LH_ItemCondition=3000&rt=nc&LH_Sold=1",
    }

# ─────────────────────────────────────────────
# PSA MARKDOWN PARSER
# ─────────────────────────────────────────────
def parse_psa_markdown(md: str, psa_url: str = "") -> dict:
    """Extract structured PSA data from raw Firecrawl markdown."""
    result = {
        "title": None,
        "cert_number": None,
        "item_grade": None,
        "psa_population": None,
        "psa_estimate": None,
        "image_front_url": None,
        "latest_sale_price": None,
        "latest_sale_date": None,
        "psa_url": psa_url,
    }

    lines = md.split('\n')

    # ── Title ─────────────────────────────────────────────────
    # PSA pages have TWO H1 lines:
    #   1. "# 150793295"           ← cert number heading (skip)
    #   2. "# 2025 ONE PIECE ..."  ← actual card name (use this)
    h1_lines = [l.strip() for l in lines if l.strip().startswith('# ') and not l.strip().startswith('## ')]
    for h1 in h1_lines:
        candidate = h1.lstrip('#').strip()
        # Skip if it looks like a bare cert number (all digits)
        if candidate.isdigit():
            continue
        result["title"] = candidate
        break

    # ── First card image ───────────────────────────────────────
    img_match = re.search(r'!\[Cert image[^\]]*\]\((https?://[^\)]+)\)', md)
    if img_match:
        result["image_front_url"] = img_match.group(1)
    else:
        # fallback to first image
        img_match = re.search(r'!\[.*?\]\((https?://[^\)]+)\)', md)
        if img_match:
            result["image_front_url"] = img_match.group(1)

    # ── Key-Value pairs ────────────────────────────────────────
    # PSA markdown renders values either inline: "Cert Number150793295"
    # or on the next line:
    #   "Item Grade"
    #   "GEM MT 10"
    for i, line in enumerate(lines):
        s = line.strip()

        def next_nonempty(idx):
            for j in range(idx + 1, min(idx + 4, len(lines))):
                v = lines[j].strip()
                if v and not v.startswith('!') and not v.startswith('['):
                    return v
            return None

        # Cert Number
        if not result["cert_number"]:
            m = re.search(r'Cert Number\s*[:\|]?\s*([0-9]+)', s)
            if m:
                result["cert_number"] = m.group(1)
            elif s == 'Cert Number':
                nxt = next_nonempty(i)
                if nxt and nxt.isdigit():
                    result["cert_number"] = nxt

        # Item Grade
        if not result["item_grade"]:
            m = re.search(r'Item Grade\s*[:\|]?\s*([A-Z][A-Z\s]+[0-9]?\.?[0-9]?)', s)
            if m:
                g = m.group(1).strip()
                if 2 < len(g) < 25:
                    result["item_grade"] = g
            elif 'Item Grade' in s:
                nxt = next_nonempty(i)
                if nxt and len(nxt) < 25:
                    result["item_grade"] = nxt

        # PSA Population
        if not result["psa_population"]:
            m = re.search(r'PSA Population\s*[:\|]?\s*([^\[\n\|]+)', s)
            if m:
                pop = m.group(1).strip()
                if pop:
                    result["psa_population"] = pop

        # PSA Estimate
        if not result["psa_estimate"]:
            m = re.search(r'(?:PSA )?(?:SMR|Estimate|Price Guide)\s*[:\|]?\s*(\$[\d,\.]+)', s, re.IGNORECASE)
            if m:
                result["psa_estimate"] = m.group(1)
            elif 'Price Guide' in s or 'SMR Price' in s:
                nxt = next_nonempty(i)
                if nxt and '$' in nxt:
                    result["psa_estimate"] = nxt

    # ── Latest sale: $price + date pattern ──────────────────
    sale_matches = re.findall(
        r'(\$[\d,]+\.?\d*)[^\d]{0,10}([\d]{2}/[\d]{2}/[\d]{2,4})',
        md
    )
    if sale_matches:
        result["latest_sale_price"] = sale_matches[0][0]
        result["latest_sale_date"]  = sale_matches[0][1]

    return result


# ─────────────────────────────────────────────
# PRICECHARTING MARKDOWN PARSER HELPERS
# ─────────────────────────────────────────────
def _parse_price_cell(cell: str) -> tuple:
    """
    Split a table cell like '$23.00<br> <br> -$0.74' into (price_float, change_float).
    Returns (None, None) if parsing fails.
    """
    parts = re.split(r'<br\s*/?>', cell, flags=re.IGNORECASE)
    parts = [p.strip() for p in parts if p.strip() and p.strip() != '']

    price  = None
    change = None

    for part in parts:
        num = re.sub(r'[^0-9\.\-\+]', '', part.replace(',', ''))
        try:
            val = float(num)
        except ValueError:
            continue
        if price is None:
            price = val
        elif change is None:
            change = val
            break

    return price, change


def _parse_volume_cell(cell: str) -> str:
    """Extract 'volume: X sales per Y' → 'X sales per Y'."""
    m = re.search(r'volume:\s*(.+)', cell, re.IGNORECASE)
    return m.group(1).strip() if m else cell.strip()


# ─────────────────────────────────────────────
# PRICECHARTING MARKDOWN PARSER
# ─────────────────────────────────────────────
def parse_pc_markdown(md: str, pc_url: str = "") -> dict:
    """
    Extract structured PriceCharting data from raw Firecrawl markdown.
    Spec-compliant:
      - Title   : first H1, strip '#', replace \\# with #, remove trailing link block
      - PC URL  : outer href from [![img](img_url)](page_url)
      - Image   : prioritized card thumbnail from Firecrawl markdown
      - Table   : dynamic header matching for Grade 9 and PSA 10
    """
    result = {
        "title":             None,
        "pricecharting_url": pc_url,
        "image_url":         None,
        "psa9_summary":      {},
        "psa10_summary":     {},
        "sales_velocity":    None,
    }

    lines = md.split('\n')

    # ── Title ──────────────────────────────────────────
    for line in lines:
        s = line.strip()
        if s.startswith('# '):
            raw_title = s[2:].strip()
            raw_title = raw_title.replace(r'\#', '#')
            # Remove trailing markdown link/image block
            raw_title = re.sub(r'\s*!?\[.*?\]\(.*?\)\s*$', '', raw_title).strip()
            raw_title = re.sub(r'\s*\[.*$', '', raw_title).strip()
            result["title"] = raw_title
            break

    # ── Preferred Card Image ───────────────────────────
    # We look for images in a prioritized way:
    # 1. Images with "alternate" or "alt art" in alt text (if title has it)
    # 2. First image that is NOT a logo or app icon
    # 3. First image from storage.googleapis.com (PriceCharting Card Storage)
    
    img_matches = re.findall(r'!\[(.*?)\]\((https?://[^\)]+)\)', md)
    best_img = None
    for alt, url in img_matches:
        alt_l = alt.lower()
        url_l = url.lower()
        # Skip small icons/logos
        if any(x in url_l for x in ['logo', 'icon', 'sprite', 'avatar', 'apple-touch']):
            continue
        # High priority: storage.googleapis is PriceCharting's own card image host
        if 'storage.googleapis' in url_l:
            best_img = url
            break
        # Medium priority: matches title keywords
        if result["title"] and any(word in alt_l for word in result["title"].lower().split()[:3]):
            best_img = url
            # don't break, keep looking for googleapis
        
        if not best_img:
            best_img = url

    result["image_url"] = best_img

    # ── Sales Velocity ──────────────────────────────────
    # Look for patterns like "[1 sale per day]" or "1.2 sales per month"
    vel_m = re.search(r'\[?(\d+(?:\.\d+)?\s+sales?\s+per\s+\w+)\]?', md, re.IGNORECASE)
    if vel_m:
        result["sales_velocity"] = vel_m.group(1).strip()

    # ── Dynamic Price Table ─────────────────────────────
    header_idx = None
    headers = []
    for i, line in enumerate(lines):
        if 'Ungraded' in line and ('Grade 9' in line or 'PSA 9' in line or 'PSA 10' in line):
            header_idx = i
            headers = [h.strip() for h in line.split('|')]
            break

    if header_idx is not None:
        # Find column indices
        idx_9 = None
        idx_10 = None
        for idx, h in enumerate(headers):
            if 'Grade 9' in h or 'PSA 9' in h:
                idx_9 = idx
            elif 'PSA 10' in h:
                idx_10 = idx

        data_start = header_idx + 2
        price_row = None
        volume_row = None

        for line in lines[data_start : data_start + 15]:
            s = line.strip()
            if not s.startswith('|'):
                continue
            cells = [c.strip() for c in s.split('|')]
            
            if 'volume:' in s.lower():
                volume_row = cells
            elif price_row is None and '$' in s:
                price_row = cells

        # Map Grade 9
        if idx_9 is not None and idx_9 < len(price_row if price_row else []):
            p, c = _parse_price_cell(price_row[idx_9])
            result["psa9_summary"]["price"] = p
            result["psa9_summary"]["change"] = c
            if volume_row and idx_9 < len(volume_row):
                result["psa9_summary"]["volume_display"] = _parse_volume_cell(volume_row[idx_9])

        # Map PSA 10
        if idx_10 is not None and idx_10 < len(price_row if price_row else []):
            p, c = _parse_price_cell(price_row[idx_10])
            result["psa10_summary"]["price"] = p
            result["psa10_summary"]["change"] = c
            if volume_row and idx_10 < len(volume_row):
                result["psa10_summary"]["volume_display"] = _parse_volume_cell(volume_row[idx_10])

    return result

# ─────────────────────────────────────────────
# FIRECRAWL ASYNC (MARKDOWN MODE)
# ─────────────────────────────────────────────
async def scrape_markdown_async(api_key: str, url: str) -> str:
    """Scrape a URL with Firecrawl and return raw markdown."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        start = await client.post(
            "https://api.firecrawl.dev/v1/scrape",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"url": url, "formats": ["markdown"]}
        )
        if start.status_code != 200:
            raise Exception(f"Firecrawl scrape error ({start.status_code}): {start.text}")
        data = start.json()
        # v1 /scrape returns synchronously
        md = data.get("data", {}).get("markdown") or data.get("markdown") or ""
        return md

# ─────────────────────────────────────────────
# SERPAPI SEARCH (ASYNC via httpx)
# ─────────────────────────────────────────────
async def find_pricecharting_url(api_key: str, title: str) -> str | None:
    """Use SerpAPI to locate the best pricecharting.com/game/ URL for a card."""
    clean = clean_psa_title(title)
    words = clean.split()
    
    # Build cascading queries
    queries = [
        f"site:pricecharting.com {clean}",
        f"site:pricecharting.com {' '.join(words[:5])}" if len(words) > 4 else None,
        f"site:pricecharting.com {' '.join(words[:3])}" if len(words) > 2 else None,
    ]
    queries = [q for q in queries if q]

    async with httpx.AsyncClient(timeout=15.0) as client:
        for query in queries:
            url = (
                "https://serpapi.com/search.json"
                f"?engine=google_light&google_domain=google.com&hl=en&gl=us"
                f"&location=United+States"
                f"&q={urllib.parse.quote(query)}"
                f"&api_key={api_key}"
            )
            res = await client.get(url)
            if res.status_code != 200:
                continue
            organics = res.json().get("organic_results", [])
            for item in organics:
                link = item.get("link", "")
                if "pricecharting.com/game/" in link:
                    return link
    return None

# ─────────────────────────────────────────────
# MAIN BACKGROUND SCRAPER
# ─────────────────────────────────────────────
async def async_scrape_pipeline(barcode: str, db_id: int):
    db = SessionLocal()
    process = db.query(CardProcess).filter(CardProcess.id == db_id).first()
    if not process:
        db.close()
        return

    result = {"barcode": barcode, "psa": {}, "pricecharting": None, "ebay": {}, "status": "processing"}

    try:
        process.status = "processing"
        db.commit()

        fc_key   = os.getenv("FIRECRAWL_API_KEY")
        serp_key = os.getenv("SERPAPI_KEY")

        if not fc_key or not serp_key:
            raise Exception("API keys missing in .env")

        # ── STEP 1: SCRAPE PSA ──────────────────────────────────
        psa_url = f"https://www.psacard.com/cert/{barcode}/psa"
        psa_md  = await scrape_markdown_async(fc_key, psa_url)

        if not psa_md or len(psa_md) < 100:
            raise Exception("PSA page returned empty/too-short markdown. Card may not exist.")

        psa_data = parse_psa_markdown(psa_md, psa_url=psa_url)
        result["psa"] = psa_data

        title = psa_data.get("title") or ""
        grade = psa_data.get("item_grade") or ""

        if not title or "Certification Verification" in title:
            raise Exception(f"PSA title parse failed. Got: '{title}'")

        # ── STEP 2: EBAY LINKS (instant, no API call) ───────────
        result["ebay"] = build_ebay_links(title, grade)

        # ── STEP 3: PRICECHARTING (SerpAPI + Firecrawl) ─────────
        try:
            pc_url = await find_pricecharting_url(serp_key, title)

            if not pc_url:
                raise ValueError("No valid PriceCharting URL found for this card.")

            pc_md   = await scrape_markdown_async(fc_key, pc_url)
            pc_data = parse_pc_markdown(pc_md, pc_url=pc_url)
            result["pricecharting"] = pc_data
            result["status"] = "complete"

        except ValueError as ve:
            # Partial: PSA ok, PC not found
            result["status"] = "partial"
            result["pricecharting"] = None
            process.error_message = str(ve)

        process.status = result["status"]
        process.result_json = json.dumps(result)
        db.commit()

    except Exception as e:
        result["status"] = "error"
        process.status = "error"
        process.error_message = str(e)
        process.result_json = json.dumps(result)
        db.commit()
    finally:
        db.close()


def run_pipeline(barcode: str, db_id: int):
    asyncio.run(async_scrape_pipeline(barcode, db_id))


# ─────────────────────────────────────────────
# FASTAPI ENDPOINTS
# ─────────────────────────────────────────────
@app.post("/process")
def process_barcode(req: ProcessRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    try:
        # Cache check
        cached = db.query(CardProcess).filter(
            CardProcess.barcode == req.barcode,
            CardProcess.status.in_(["complete", "partial"])
        ).first()

        if cached and cached.result_json:
            data = json.loads(cached.result_json)
            return {"id": cached.id, "cached": True, **data}

        new_process = CardProcess(barcode=req.barcode)
        db.add(new_process)
        db.commit()
        db.refresh(new_process)

        background_tasks.add_task(run_pipeline, req.barcode, new_process.id)
        return {"id": new_process.id, "barcode": req.barcode, "status": "pending", "cached": False}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Database unavailable: {str(e)}")


@app.get("/status/{process_id}")
def get_status(process_id: int, db: Session = Depends(get_db)):
    process = db.query(CardProcess).filter(CardProcess.id == process_id).first()
    if not process:
        raise HTTPException(status_code=404, detail="Process not found")

    if process.result_json:
        data = json.loads(process.result_json)
        return {"id": process.id, "error_message": process.error_message, **data}

    return {
        "id": process.id,
        "barcode": process.barcode,
        "status": process.status,
        "error_message": process.error_message,
    }
