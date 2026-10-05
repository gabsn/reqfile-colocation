import secrets

from app.teams import get_team
from app.invites_store import INVITES


def send_invite(team_id, email):
    if get_team(team_id) is None:
        return {"error": "no such team"}
    token = secrets.token_hex(8)
    INVITES[token] = {"team_id": team_id, "email": email}
    return {"token": token}


def accept_invite(token):
    invite = INVITES.pop(token, None)
    if invite is None:
        return {"error": "invalid invite"}
    get_team(invite["team_id"])["members"].append(invite["email"])
    return {"team_id": invite["team_id"]}
