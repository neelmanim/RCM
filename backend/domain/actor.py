"""Who is asking — independent of how they authenticated.

Authorisation rules used to take the raw JWT claims dict straight from
`get_current_user`, which quietly made every rule an HTTP concern. Two costs
showed up in practice:

  * `routes/public_api_routes.py` had to fabricate
    `{"role": "Super Admin", "sub": "public-api-key"}` to call a domain rule,
    because the rule demanded a token shape. A synthetic Super Admin is a
    dangerous thing to have lying around.
  * Role decisions spread as bare string comparisons — 27 of them across 12
    route files at last count — each an independent chance to write
    `== "Pod Admin"` where the rule needed `in ("Super Admin", "Pod Admin")`.
    That is the exact shape of the v12.2.1 privilege-escalation fixes.

`Actor` is the boundary type. Transport layers build one; domain rules only
ever see this.
"""
from dataclasses import dataclass
from typing import Optional

# Canonical role names. "Admin" is the V1 spelling of Super Admin and still
# appears in old rows and old tokens — normalised away in from_claims().
SUPER_ADMIN = "Super Admin"
POD_ADMIN = "Pod Admin"
AE = "AE"
SDR = "SDR"
CSM = "CSM"

# Single source of truth for "is this a real role" checks — previously
# duplicated as literal `valid_roles = {...}` sets in admin_user_routes.py
# (x2) and auth_routes.py, one per role addition to keep in sync by hand.
VALID_ROLES = (SUPER_ADMIN, POD_ADMIN, AE, SDR, CSM)

_LEGACY_ROLES = {"Admin": SUPER_ADMIN}


@dataclass(frozen=True)
class Actor:
    """An authenticated caller, normalised. Immutable on purpose — a rule must
    not be able to widen its own caller's scope."""

    id: str
    role: str
    pod_id: Optional[str] = None
    email: str = ""
    #: True for non-human callers (public API keys, scheduled jobs). Kept
    #: explicit so an audit can tell a real Super Admin from a service token
    #: that merely has the same reach.
    is_service: bool = False

    # ── Construction ─────────────────────────────────────────────────────────

    @classmethod
    def from_claims(cls, claims: dict) -> "Actor":
        """Build from `get_current_user`'s JWT claims. Accepts the dict shape
        every existing route already has, so callers migrate one at a time."""
        role = claims.get("role") or ""
        return cls(
            id=claims.get("sub") or "",
            role=_LEGACY_ROLES.get(role, role),
            pod_id=claims.get("pod_id"),
            email=claims.get("email") or "",
        )

    @classmethod
    def service(cls, name: str, role: str = SUPER_ADMIN) -> "Actor":
        """A non-human caller. `name` lands in audit trails, so make it
        recognisable ("public-api-key", "scheduled-campaign-job")."""
        return cls(id=name, role=role, email=name, is_service=True)

    # ── Role predicates ──────────────────────────────────────────────────────
    # One place to be wrong, instead of 27.

    @property
    def is_super_admin(self) -> bool:
        return self.role == SUPER_ADMIN

    @property
    def is_pod_admin(self) -> bool:
        return self.role == POD_ADMIN

    @property
    def is_admin(self) -> bool:
        """Super Admin or Pod Admin — the "can administer something" tier.
        Mirrors auth.require_admin, which is the HTTP-side gate."""
        return self.role in (SUPER_ADMIN, POD_ADMIN)

    @property
    def is_individual_contributor(self) -> bool:
        """SDR or AE — sees only their own book of business."""
        return self.role in (SDR, AE)

    @property
    def is_csm(self) -> bool:
        """Customer Success Manager — scoped to an assigned account
        portfolio, not "own leads/calls" like SDR/AE, so deliberately kept
        out of is_individual_contributor rather than folded in."""
        return self.role == CSM
