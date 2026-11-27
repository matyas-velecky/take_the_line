import asyncio
import math
import re
import time
from pathlib import Path

import socketio
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

fastapi_app = FastAPI()
sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"

PLAYER_SPEED = 15.0
TURN_SPEED = 2.5
MAX_TRAIL_SEGMENTS = 20
COUNTDOWN_SECONDS = 10
TICK_RATE = 60

sid_to_player = {}
sid_to_room = {}
rooms = {}
next_room_id = 1


def new_player(number, color):
    x = -20.0 if number == 1 else 20.0
    heading = math.pi / 2 if number == 1 else -math.pi / 2
    return {
        "position": [x, 0.5, 0.0],
        "heading": heading,
        "color": color,
        "keys": set(),
        "trails": [],
        "last_trail": [x, 0.0],
        "game_over": False,
    }


def new_room(room_id):
    return {
        "id": room_id,
        "participants": {},
        "players": {
            1: new_player(1, "#ff0000"),
            2: new_player(2, "#00ffff"),
        },
        "winner": None,
        "started": False,
        "countdown_deadline": None,
    }


def reset_room(room):
    room["winner"] = None
    room["started"] = False
    room["countdown_deadline"] = (
        time.monotonic() + COUNTDOWN_SECONDS
        if len(room["participants"]) == 2
        else None
    )
    for number, position, heading in (
        (1, [-20.0, 0.5, 0.0], math.pi / 2),
        (2, [20.0, 0.5, 0.0], -math.pi / 2),
    ):
        color = room["players"][number]["color"]
        room["players"][number] = {
            "position": position,
            "heading": heading,
            "color": color,
            "keys": set(),
            "trails": [],
            "last_trail": [position[0], position[2]],
            "game_over": False,
        }


def state_payload(room):
    payload = {
        "room": room["id"],
        "started": room["started"],
        "countdown": (
            max(0.0, room["countdown_deadline"] - time.monotonic())
            if room["countdown_deadline"] is not None
            else None
        ),
        "winner": room["winner"],
        "players": {},
    }

    for number, player in room["players"].items():
        payload["players"][str(number)] = {
            "position": player["position"],
            "heading": player["heading"],
            "color": player["color"],
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


def hit_trail(room, player_number, ignore_recent=0):
    position = room["players"][player_number]["position"]

    for owner_number, player in room["players"].items():
        if owner_number not in room["participants"]:
            continue
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


async def emit_room_state(room):
    await sio.emit("state", state_payload(room), room=room["id"])


@fastapi_app.get("/")
def home():
    return FileResponse(frontend_dist / "index.html")


@fastapi_app.get("/healthz")
def health():
    return {"status": "ok"}


@sio.event
async def connect(sid, environ):
    global next_room_id
    room = next(
        (candidate for candidate in rooms.values() if len(candidate["participants"]) < 2),
        None,
    )
    if room is None:
        room_id = str(next_room_id)
        next_room_id += 1
        room = new_room(room_id)
        rooms[room_id] = room

    player_number = next(
        number for number in (1, 2) if number not in room["participants"]
    )
    sid_to_player[sid] = player_number
    sid_to_room[sid] = room["id"]
    room["participants"][player_number] = sid
    await sio.enter_room(sid, room["id"])
    if len(room["participants"]) == 2:
        room["countdown_deadline"] = time.monotonic() + COUNTDOWN_SECONDS

    await sio.emit(
        "assigned",
        {"player": player_number, "room": room["id"]},
        room=sid,
    )
    await emit_room_state(room)


@sio.event
async def disconnect(sid):
    player_number = sid_to_player.pop(sid, None)
    room_id = sid_to_room.pop(sid, None)
    room = rooms.get(room_id)
    if room is None:
        return
    room["participants"].pop(player_number, None)
    reset_room(room)
    if room["participants"]:
        await emit_room_state(room)
    else:
        rooms.pop(room_id, None)


@sio.event
async def input(sid, data):
    player_number = sid_to_player.get(sid)
    room = rooms.get(sid_to_room.get(sid))
    if player_number is None or room is None:
        return

    room["players"][player_number]["keys"] = set(data.get("keys", []))


@sio.event
async def set_color(sid, data):
    player_number = sid_to_player.get(sid)
    room = rooms.get(sid_to_room.get(sid))
    color = data.get("color", "") if isinstance(data, dict) else ""
    if (
        player_number is None
        or room is None
        or not isinstance(color, str)
        or re.fullmatch(r"#[0-9a-fA-F]{6}", color) is None
    ):
        return

    room["players"][player_number]["color"] = color.lower()
    await emit_room_state(room)


@sio.event
async def restart(sid):
    room = rooms.get(sid_to_room.get(sid))
    if room is not None and len(room["participants"]) == 2:
        reset_room(room)
        await emit_room_state(room)


async def game_loop():
    while True:
        await asyncio.sleep(1 / TICK_RATE)
        delta = 1 / TICK_RATE

        for room in list(rooms.values()):
            if room["countdown_deadline"] is not None:
                if time.monotonic() >= room["countdown_deadline"]:
                    room["countdown_deadline"] = None
                    room["started"] = True
                else:
                    room["started"] = False

            if len(room["participants"]) != 2:
                room["started"] = False
                room["countdown_deadline"] = None

            if not room["started"] or room["winner"] is not None:
                await emit_room_state(room)
                continue

            for number, player in room["players"].items():
                if number not in room["participants"] or player["game_over"]:
                    continue

                keys = player["keys"]
                if number == 1:
                    move_x = int("d" in keys) - int("a" in keys)
                    move_z = int("s" in keys) - int("w" in keys)
                else:
                    move_x = int("arrowright" in keys) - int("arrowleft" in keys)
                    move_z = int("arrowdown" in keys) - int("arrowup" in keys)

                if move_x or move_z:
                    target_heading = math.atan2(move_x, move_z)
                    heading_difference = (
                        target_heading - player["heading"] + math.pi
                    ) % (2 * math.pi) - math.pi
                    turn_amount = max(
                        -TURN_SPEED * delta,
                        min(TURN_SPEED * delta, heading_difference),
                    )
                    player["heading"] += turn_amount

                player["position"][0] += math.sin(player["heading"]) * PLAYER_SPEED * delta
                player["position"][2] += math.cos(player["heading"]) * PLAYER_SPEED * delta

                player["position"][0] = max(-49, min(49, player["position"][0]))
                player["position"][2] = max(-49, min(49, player["position"][2]))

                end_x = player["position"][0]
                end_z = player["position"][2]
                last_x, last_z = player["last_trail"]

                if math.hypot(end_x - last_x, end_z - last_z) >= 0.15:
                    player["trails"].append([last_x, last_z, end_x, end_z])
                    del player["trails"][:-MAX_TRAIL_SEGMENTS]
                    player["last_trail"] = [end_x, end_z]

            positions = {
                number: player["position"]
                for number, player in room["players"].items()
            }

            if math.hypot(
                positions[1][0] - positions[2][0],
                positions[1][2] - positions[2][2],
            ) < 2:
                room["winner"] = "Draw"
                room["players"][1]["game_over"] = True
                room["players"][2]["game_over"] = True
            else:
                player_one_hit = hit_trail(
                    room, 1, ignore_recent=len(room["players"][1]["trails"][-12:])
                )
                player_two_hit = hit_trail(
                    room, 2, ignore_recent=len(room["players"][2]["trails"][-12:])
                )

                if player_one_hit:
                    room["winner"] = "Player 2"
                    room["players"][1]["game_over"] = True
                if player_two_hit:
                    room["winner"] = "Player 1"
                    room["players"][2]["game_over"] = True

            await emit_room_state(room)


@fastapi_app.on_event("startup")
async def start_game_loop():
    sio.start_background_task(game_loop)

fastapi_app.mount("/", StaticFiles(directory=frontend_dist), name="frontend")

app = socketio.ASGIApp(sio, fastapi_app, socketio_path="socket.io")