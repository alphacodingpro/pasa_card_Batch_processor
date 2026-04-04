import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

load_dotenv()

# Get the PostgreSQL connection URL from the environment variables
SQLALCHEMY_DATABASE_URL = os.getenv("POSTGRES_URL", "postgresql://mac@localhost/postgres")

# Fix: Render gives internal URL (dpg-xxx-a) - convert to external URL for cross-region access
if SQLALCHEMY_DATABASE_URL.startswith("postgres://"):
    SQLALCHEMY_DATABASE_URL = SQLALCHEMY_DATABASE_URL.replace("postgres://", "postgresql://", 1)

# Auto-convert Render internal hostname to external hostname
import re as _re
_internal_pattern = _re.compile(r'@(dpg-[a-z0-9]+-[a-z])/')
_match = _internal_pattern.search(SQLALCHEMY_DATABASE_URL)
if _match:
    internal_host = _match.group(1)
    external_host = f"{internal_host}.oregon-postgres.render.com"
    SQLALCHEMY_DATABASE_URL = SQLALCHEMY_DATABASE_URL.replace(f"@{internal_host}/", f"@{external_host}/")
    print(f"🔧 Converted DB host: {internal_host} → {external_host}")

engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
