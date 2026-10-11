"""
AES-256-GCM encryption/decryption for application credentials.
Shared across Salesforce, Nylas, and Aircall integrations.
"""
import os
import base64
import logging

logger = logging.getLogger(__name__)


def _get_key():
    """Load the encryption key from environment."""
    key_b64 = os.getenv("APP_ENCRYPTION_KEY")
    if not key_b64:
        raise ValueError(
            "APP_ENCRYPTION_KEY environment variable is required. "
            "Generate with: python3 -c \"import os,base64;print(base64.b64encode(os.urandom(32)).decode())\""
        )
    key = base64.b64decode(key_b64)
    if len(key) != 32:
        raise ValueError("APP_ENCRYPTION_KEY must be a base64-encoded 32-byte key")
    return key


def encrypt_token(plaintext: str) -> str:
    """Encrypt a plaintext string using AES-256-GCM."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    key = _get_key()
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    ciphertext = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
    return base64.b64encode(nonce + ciphertext).decode("utf-8")


def decrypt_token(encrypted: str) -> str:
    """Decrypt an AES-256-GCM encrypted string."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    key = _get_key()
    combined = base64.b64decode(encrypted)
    nonce = combined[:12]
    ciphertext = combined[12:]
    aesgcm = AESGCM(key)
    return aesgcm.decrypt(nonce, ciphertext, None).decode("utf-8")
