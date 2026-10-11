"""
Base model utilities shared across all domain models.
"""
import uuid
from database import Base


def generate_uuid():
    return str(uuid.uuid4())
