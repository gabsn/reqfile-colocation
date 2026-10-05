from app.teams import create_team
from app.invites import accept_invite, send_invite


def test_accepted_invite_adds_member():
    team = create_team("ops")
    token = send_invite(team["id"], "a@example.com")["token"]
    assert accept_invite(token) == {"team_id": team["id"]}
    assert accept_invite(token) == {"error": "invalid invite"}
