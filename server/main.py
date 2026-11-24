import asyncio
import math
from pathlib import Path

import socketio
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

fastapi_app = FastAPI()
sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"

players = {}
sid_to_player = {}
ready_players = set()
match = {
    "players": {
        1: {"position": [-20.0, 0.5, 0.0], "keys": set(), "trails": [], "last_trail": [-20.0, 0.0], "game_over": False},
        2: {"position": [20.0, 0.5, 0.0], "keys": set(), "trails": [], "last_trail": [20.0, 0.0], "game_over": False},
    },
    "winner": None,
    "started": False,
}


def reset_match():
    match["winner"] = None
    match["started"] = len(ready_players) >= 2
    for number, position in ((1, [-20.0, 0.5, 0.0]), (2, [20.0, 0.5, 0.0])):
        match["players"][number] = {
            "position": position,
            "keys": set(),
            "trails": [],
            "last_trail": [position[0], position[2]],
            "game_over": False,
        }


def state_payload():
    payload = {
        "started": match["started"],
        "winner": match["winner"],
        "players": {},
    }

    for number, player in match["players"].items():
        payload["players"][str(number)] = {
            "position": player["position"],
            "trails": player["trails"],
            "game_over": player["game_over"],
        }

    return payload


def point_segment_distance(px, pz, start, end):
    ax, az = start
    bx, bz = end
    dx = bx - ax
    dz = bz - az
    length_squared = dx * dx + dz * dz

    if length_squared == 0:
        return math.hypot(px - ax, pz - az)

    t = max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / length_squared))
    closest_x = ax + t * dx
    closest_z = az + t * dz
    return math.hypot(px - closest_x, pz - closest_z)


def hit_trail(player_number, ignore_recent=0):
    position = match["players"][player_number]["position"]

    for owner_number, player in match["players"].items():
        segments = player["trails"]

        if owner_number == player_number and ignore_recent:
            segments = segments[:-ignore_recent]

        for segment in segments:
            distance = point_segment_distance(
                position[0],
                position[2],
                (segment[0], segment[1]),
                (segment[2], segment[3]),
            )
            if distance < 1.4:
                return True

    return False


@fastapi_app.get("/")
def home():
    return FileResponse(frontend_dist / "index.html")


@fastapi_app.get("/healthz")
def health():
    return {"status": "ok"}


@sio.event
async def connect(sid, environ):
    if len(sid_to_player) >= 2:
        await sio.emit("waiting", room=sid)
        return

    player_number = 1 if 1 not in players else 2
    players[player_number] = sid
    sid_to_player[sid] = player_number
    match["started"] = False
    await sio.emit("assigned", {"player": player_number}, room=sid)
    await sio.emit("state", state_payload())


@sio.event
async def disconnect(sid):
    ready_players.discard(sid)
    player_number = sid_to_player.pop(sid, None)
    if player_number is not None:
        players.pop(player_number, None)
    reset_match()
    await sio.emit("state", state_payload())


@sio.event
async def ready(sid):
    if sid in sid_to_player:
        ready_players.add(sid)
        match["started"] = len(ready_players) >= 2
        await sio.emit("state", state_payload())


@sio.event
async def input(sid, data):
    player_number = sid_to_player.get(sid)
    if player_number is None:
        return

    match["players"][player_number]["keys"] = set(data.get("keys", []))


@sio.event
async def restart(sid):
    if sid in sid_to_player:
        reset_match()
        await sio.emit("state", state_payload())


async def game_loop():
    while True:
        await asyncio.sleep(1 / 60)

        if not match["started"] or match["winner"] is not None:
            await sio.emit("state", state_payload())
            continue

        for number, player in match["players"].items():
            if player["game_over"]:
                continue

            keys = player["keys"]
            move_x = 0
            move_z = 0

            if number == 1:
                move_x -= "a" in keys
                move_x += "d" in keys
                move_z -= "w" in keys
                move_z += "s" in keys
            else:
                move_x -= "arrowleft" in keys
                move_x += "arrowright" in keys
                move_z -= "arrowup" in keys
                move_z += "arrowdown" in keys

            if move_x or move_z:
                length = math.hypot(move_x, move_z)
                player["position"][0] += (move_x / length) * (20 / 60)
                player["position"][2] += (move_z / length) * (20 / 60)

                player["position"][0] = max(-49, min(49, player["position"][0]))
                player["position"][2] = max(-49, min(49, player["position"][2]))

                end_x = player["position"][0]
                end_z = player["position"][2]
                last_x, last_z = player["last_trail"]

                if math.hypot(end_x - last_x, end_z - last_z) >= 0.15:
                    player["trails"].append([last_x, last_z, end_x, end_z])
                    player["last_trail"] = [end_x, end_z]

        positions = {
            number: player["position"]
            for number, player in match["players"].items()
        }

        if math.hypot(
            positions[1][0] - positions[2][0],
            positions[1][2] - positions[2][2],
        ) < 2:
            match["winner"] = "Draw"
            match["players"][1]["game_over"] = True
            match["players"][2]["game_over"] = True
        else:
            player_one_hit = hit_trail(1, ignore_recent=len(match["players"][1]["trails"][-12:]))
            player_two_hit = hit_trail(2, ignore_recent=len(match["players"][2]["trails"][-12:]))

            if player_one_hit:
                match["winner"] = "Player 2"
                match["players"][1]["game_over"] = True
            if player_two_hit:
                match["winner"] = "Player 1"
                match["players"][2]["game_over"] = True

        await sio.emit("state", state_payload())


@fastapi_app.on_event("startup")
async def start_game_loop():
    sio.start_background_task(game_loop)

fastapi_app.mount("/", StaticFiles(directory=frontend_dist), name="frontend")

app = socketio.ASGIApp(sio, fastapi_app, socketio_path="socket.io")