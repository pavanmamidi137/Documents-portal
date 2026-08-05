from rest_framework.throttling import AnonRateThrottle, UserRateThrottle


class LoginRateThrottle(AnonRateThrottle):
    """Limits login attempts per IP to slow brute-force attacks."""

    scope = "login"


class BurstRateThrottle(UserRateThrottle):
    """Generous per-user ceiling for normal API usage."""

    scope = "user"
