from app.teams import create_team, get_team


def test_created_team_can_be_read():
    team = create_team("core")
    assert get_team(team["id"])["name"] == "core"
