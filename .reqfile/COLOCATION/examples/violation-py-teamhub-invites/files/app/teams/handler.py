from .store import TEAMS


def create_team(name):
    team_id = str(len(TEAMS) + 1)
    TEAMS[team_id] = {"id": team_id, "name": name, "members": []}
    return TEAMS[team_id]


def get_team(team_id):
    return TEAMS.get(team_id)
