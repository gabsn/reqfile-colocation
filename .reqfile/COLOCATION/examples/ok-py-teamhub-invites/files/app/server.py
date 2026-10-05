from app.health import health
from app.teams import create_team, get_team
from app.invites import accept_invite, send_invite

ROUTES = {
    ("GET", "/health"): health,
    ("POST", "/teams"): create_team,
    ("GET", "/teams/{id}"): get_team,
    ("POST", "/teams/{id}/invites"): send_invite,
    ("POST", "/invites/{token}/accept"): accept_invite,
}


def dispatch(method, route, *args):
    return ROUTES[(method, route)](*args)
