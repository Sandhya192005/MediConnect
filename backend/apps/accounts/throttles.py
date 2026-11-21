from rest_framework.throttling import SimpleRateThrottle


class ResetEmailThrottle(SimpleRateThrottle):
    """
    Limits "Forgot password?" emails per email address (scope "password_reset_email"),
    so nobody can flood one person's inbox, whichever network they send from.
    """

    scope = "password_reset_email"

    def get_cache_key(self, request, view):
        email = str(request.data.get("email", "")).strip().lower()
        if not email:
            return None  # no email: the request fails validation anyway
        return self.cache_format % {"scope": self.scope, "ident": email}
