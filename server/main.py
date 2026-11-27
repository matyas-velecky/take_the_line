import asyncio
import math
import re
import secrets
import string
import time
from collections import deque
from pathlib import Path

import socketio
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

fastapi_app = FastAPI()
sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"

PLAYER_SPEED = 25.0
TURN_SPEED = 3.5
MAX_TRAIL_SEGMENTS = 1200
# Change this value to set how many trail segments each player keeps.
COUNTDOWN_SECONDS = 10
TICK_RATE = 60
STATE_UPDATE_RATE = 30
JUMP_DURATION_SECONDS = 0.75
JUMP_COOLDOWN_SECONDS = 1.5
BOOST_DURATION_SECONDS = 1.0
BOARD_SIZE = 75.0
BOARD_HALF = BOARD_SIZE / 2
PLAYER_SURFACE_OFFSET = 1.0
SURFACE_LEVEL = BOARD_HALF + PLAYER_SURFACE_OFFSET

sid_to_player = {}
sid_to_room = {}
rooms = {}
ROOM_CODE_LENGTH = 6
ROOM_CODE_CHARACTERS = string.ascii_uppercase + string.digits
ALLOWED_KEYS = frozenset(
    ("a", "d", "w", "s", "arrowleft", "arrowright", "arrowup", "arrowdown")
)


def new_player(number, color):
    x = -20.0 if number == 1 else 20.0
    return {
        "position": [x, SURFACE_LEVEL, 0.0],
        "normal": [0.0, 1.0, 0.0],
        "forward": [1.0 if number == 1 else -1.0, 0.0, 0.0],
        "color": color,
        "name": f"Player {number}",
        "keys": set(),
        "trails": deque(maxlen=MAX_TRAIL_SEGMENTS),
        "trail_updates": [],
        "last_trail": [x, SURFACE_LEVEL, 0.0],
        "jump_until": 0.0,
        "jump_ready_at": 0.0,
        "boost_until": 0.0,
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
        "trails_reset": True,
    }


def reset_room(room):
    room["winner"] = None
    room["started"] = False
    room["trails_reset"] = True
    room["countdown_deadline"] = (
        time.monotonic() + COUNTDOWN_SECONDS
        if len(room["participants"]) == 2
        else None
    )
    for number, position, forward in (
        (1, [-20.0, SURFACE_LEVEL, 0.0], [1.0, 0.0, 0.0]),
        (2, [20.0, SURFACE_LEVEL, 0.0], [-1.0, 0.0, 0.0]),
    ):
        color = room["players"][number]["color"]
        room["players"][number] = {
            "position": position,
            "normal": [0.0, 1.0, 0.0],
            "forward": forward,
            "color": color,
            "name": room["players"][number]["name"],
            "keys": set(),
            "trails": deque(maxlen=MAX_TRAIL_SEGMENTS),
            "trail_updates": [],
            "last_trail": position.copy(),
            "jump_until": 0.0,
            "jump_ready_at": 0.0,
            "boost_until": 0.0,
            "game_over": False,
        }


def state_payload(room):
    now = time.monotonic()
    payload = {
        "room": room["id"],
        "started": room["started"],
        "countdown": (
            max(0.0, room["countdown_deadline"] - time.monotonic())
            if room["countdown_deadline"] is not None
            else None
        ),
        "trails_reset": room["trails_reset"],
        "winner": room["winner"],
        "players": {},
    }

    for number, player in room["players"].items():
        payload["players"][str(number)] = {
            "position": player["position"],
            "normal": player["normal"],
            "forward": player["forward"],
            "color": player["color"],
            "name": player["name"],
            "jump_height": (
                2.5
                * math.sin(
                    math.pi
                    * (1 - (player["jump_until"] - now) / JUMP_DURATION_SECONDS)
                )
                if player["jump_until"] > now
                else 0.0
            ),
            "boosting": player["boost_until"] > now,
            "trail_updates": list(player["trail_updates"]),
            "game_over": player["game_over"],
        }

    return payload


def point_segment_distance_squared(position, segment):
    ax, ay, az, bx, by, bz = segment[:6]
    px, py, pz = position
    dx = bx - ax
    dy = by - ay
    dz = bz - az
    length_squared = dx * dx + dy * dy + dz * dz

    if length_squared == 0:
        distance_x = px - ax
        distance_y = py - ay
        distance_z = pz - az
        return distance_x * distance_x + distance_y * distance_y + distance_z * distance_z

    t = max(
        0.0,
        min(
            1.0,
            ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz)
            / length_squared,
        ),
    )
    closest_x = ax + t * dx
    closest_y = ay + t * dy
    closest_z = az + t * dz
    distance_x = px - closest_x
    distance_y = py - closest_y
    distance_z = pz - closest_z
    return distance_x * distance_x + distance_y * distance_y + distance_z * distance_z


def hit_trail(room, player_number, ignore_recent=0):
    position = room["players"][player_number]["position"]
    px, py, pz = position
    collision_distance_squared = 1.4 * 1.4

    for owner_number, player in room["players"].items():
        if owner_number not in room["participants"]:
            continue
        segments = player["trails"]
        segment_limit = (
            len(segments) - ignore_recent
            if owner_number == player_number and ignore_recent
            else len(segments)
        )

        for index, segment in enumerate(segments):
            if index >= segment_limit:
                break

            ax, ay, az, bx, by, bz = segment[:6]
            min_x, max_x = min(ax, bx) - 1.4, max(ax, bx) + 1.4
            min_y, max_y = min(ay, by) - 1.4, max(ay, by) + 1.4
            min_z, max_z = min(az, bz) - 1.4, max(az, bz) + 1.4
            if (
                px < min_x
                or px > max_x
                or py < min_y
                or py > max_y
                or pz < min_z
                or pz > max_z
            ):
                continue
            if (
                point_segment_distance_squared(position, segment)
                < collision_distance_squared
            ):
                return True

    return False


def dot(left, right):
    return sum(a * b for a, b in zip(left, right))


def cross(left, right):
    return [
        left[1] * right[2] - left[2] * right[1],
        left[2] * right[0] - left[0] * right[2],
        left[0] * right[1] - left[1] * right[0],
    ]


def rotate_vector(vector, axis, angle):
    cosine = math.cos(angle)
    sine = math.sin(angle)
    axis_cross_vector = cross(axis, vector)
    axis_dot_vector = dot(axis, vector)
    return [
        vector[index] * cosine
        + axis_cross_vector[index] * sine
        + axis[index] * axis_dot_vector * (1 - cosine)
        for index in range(3)
    ]


def append_trail_segment(player, end, normal):
    start = player["last_trail"]
    distance_squared = sum((end[index] - start[index]) ** 2 for index in range(3))
    if distance_squared < 1e-8:
        return
    segment = [*start, *end, *normal]
    player["trails"].append(segment)
    player["trail_updates"].append(segment)
    player["last_trail"] = end.copy()


def move_on_cube(player, distance):
    position = player["position"]
    normal = player["normal"]
    forward = player["forward"]
    remaining = distance
    crossings = 0

    while remaining > 1e-8 and crossings < 3:
        normal_axis = max(range(3), key=lambda axis: abs(normal[axis]))
        crossing_axis = None
        crossing_distance = remaining

        for axis in range(3):
            if axis == normal_axis or abs(forward[axis]) < 1e-8:
                continue
            boundary = SURFACE_LEVEL if forward[axis] > 0 else -SURFACE_LEVEL
            axis_distance = (boundary - position[axis]) / forward[axis]
            if -1e-8 <= axis_distance <= crossing_distance:
                crossing_axis = axis
                crossing_distance = max(0.0, axis_distance)

        for axis in range(3):
            position[axis] += forward[axis] * crossing_distance
        remaining -= crossing_distance

        if crossing_axis is None:
            break

        old_normal = normal.copy()
        crossing_sign = 1.0 if position[crossing_axis] >= 0 else -1.0
        new_normal = [0.0, 0.0, 0.0]
        new_normal[crossing_axis] = crossing_sign
        rotation_axis = cross(old_normal, new_normal)
        forward[:] = rotate_vector(forward, rotation_axis, math.pi / 2)
        normal[:] = new_normal
        position[crossing_axis] = crossing_sign * SURFACE_LEVEL
        position[normal_axis] = old_normal[normal_axis] * SURFACE_LEVEL
        append_trail_segment(player, position, old_normal)
        crossings += 1

    return crossings


async def emit_room_state(room):
    await sio.emit("state", state_payload(room), room=room["id"])
    room["trails_reset"] = False
    for player in room["players"].values():
        player["trail_updates"].clear()


def valid_player_name(name):
    return isinstance(name, str) and 1 <= len(name.strip()) <= 20


async def assign_to_room(sid, room, name):
    player_number = next(
        number for number in (1, 2) if number not in room["participants"]
    )
    room["participants"][player_number] = sid
    room["players"][player_number]["name"] = name.strip()
    sid_to_player[sid] = player_number
    sid_to_room[sid] = room["id"]
    await sio.enter_room(sid, room["id"])
    if len(room["participants"]) == 2:
        room["countdown_deadline"] = time.monotonic() + COUNTDOWN_SECONDS

    await sio.emit(
        "assigned",
        {"player": player_number, "room": room["id"], "name": name.strip()},
        room=sid,
    )
    await emit_room_state(room)


async def emit_room_error(sid, message):
    await sio.emit("room_error", {"message": message}, room=sid)


@fastapi_app.get("/")
def home():
    return FileResponse(frontend_dist / "index.html")


@fastapi_app.get("/healthz")
def health():
    return {"status": "ok"}


@sio.event
async def connect(sid, environ):
    return None


@sio.event
async def create_room(sid, data):
    if sid in sid_to_room:
        await emit_room_error(sid, "You are already in a room.")
        return
    name = data.get("name") if isinstance(data, dict) else None
    if not valid_player_name(name):
        await emit_room_error(sid, "Enter a name between 1 and 20 characters.")
        return

    room_code = "".join(
        secrets.choice(ROOM_CODE_CHARACTERS) for _ in range(ROOM_CODE_LENGTH)
    )
    while room_code in rooms:
        room_code = "".join(
            secrets.choice(ROOM_CODE_CHARACTERS) for _ in range(ROOM_CODE_LENGTH)
        )
    room = new_room(room_code)
    rooms[room_code] = room
    await assign_to_room(sid, room, name)


@sio.event
async def join_room(sid, data):
    if sid in sid_to_room:
        await emit_room_error(sid, "You are already in a room.")
        return
    name = data.get("name") if isinstance(data, dict) else None
    room_code = data.get("code", "") if isinstance(data, dict) else ""
    if not valid_player_name(name):
        await emit_room_error(sid, "Enter a name between 1 and 20 characters.")
        return
    if not isinstance(room_code, str) or re.fullmatch(
        rf"[A-Z0-9]{{{ROOM_CODE_LENGTH}}}", room_code.upper()
    ) is None:
        await emit_room_error(sid, "Enter a valid 6-character room code.")
        return

    room = rooms.get(room_code.upper())
    if room is None:
        await emit_room_error(sid, "That room code was not found.")
        return
    if len(room["participants"]) >= 2:
        await emit_room_error(sid, "That room is full.")
        return
    await assign_to_room(sid, room, name)


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

    keys = data.get("keys", []) if isinstance(data, dict) else []
    if isinstance(keys, list):
        room["players"][player_number]["keys"] = {
            key
            for key in keys
            if isinstance(key, str) and key in ALLOWED_KEYS
        }


@sio.event
async def action(sid, data):
    player_number = sid_to_player.get(sid)
    room = rooms.get(sid_to_room.get(sid))
    if (
        player_number is None
        or room is None
        or not room["started"]
        or room["winner"] is not None
        or len(room["participants"]) != 2
        or not isinstance(data, dict)
    ):
        return

    player = room["players"][player_number]
    now = time.monotonic()
    if data.get("action") == "jump" and now >= player["jump_ready_at"]:
        player["jump_until"] = now + JUMP_DURATION_SECONDS
        player["jump_ready_at"] = now + JUMP_COOLDOWN_SECONDS
    elif data.get("action") == "boost" and now >= player["boost_until"]:
        player["boost_until"] = now + BOOST_DURATION_SECONDS


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
    tick_count = 0
    while True:
        await asyncio.sleep(1 / TICK_RATE)
        tick_count += 1
        should_emit_state = tick_count % max(1, TICK_RATE // STATE_UPDATE_RATE) == 0
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
                if should_emit_state:
                    await emit_room_state(room)
                continue

            now = time.monotonic()
            for number, player in room["players"].items():
                if number not in room["participants"] or player["game_over"]:
                    continue

                keys = player["keys"]
                turn_direction = int(bool(keys & {"a", "arrowleft"})) - int(bool(keys & {"d", "arrowright"}))
                normal = player["normal"]
                forward = player["forward"]
                if turn_direction:
                    player["forward"] = rotate_vector(
                        forward, normal, turn_direction * TURN_SPEED * delta
                    )
                else:
                    move_z = int(bool(keys & {"s", "arrowdown"})) - int(
                        bool(keys & {"w", "arrowup"})
                    )
                    if move_z:
                        north = [0.0, 1.0, 0.0]
                        if abs(dot(normal, north)) > 0.9:
                            north = [0.0, 0.0, 1.0]
                        target_forward = [
                            component * (-1 if move_z > 0 else 1)
                            for component in north
                        ]
                        turn_angle = math.atan2(
                            dot(normal, cross(forward, target_forward)),
                            dot(forward, target_forward),
                        )
                        turn_amount = max(
                            -TURN_SPEED * delta,
                            min(TURN_SPEED * delta, turn_angle),
                        )
                        player["forward"] = rotate_vector(
                            forward, normal, turn_amount
                        )

                speed = PLAYER_SPEED * (2 if player["boost_until"] > now else 1)
                move_on_cube(player, speed * delta)
                append_trail_segment(player, player["position"], player["normal"])

            position_one = room["players"][1]["position"]
            position_two = room["players"][2]["position"]
            if sum(
                (position_one[index] - position_two[index]) ** 2
                for index in range(3)
            ) < 4:
                room["winner"] = "Draw"
                room["players"][1]["game_over"] = True
                room["players"][2]["game_over"] = True
            elif should_emit_state:
                player_one_hit = (
                    room["players"][1]["jump_until"] <= time.monotonic()
                    and hit_trail(
                        room,
                        1,
                        ignore_recent=min(12, len(room["players"][1]["trails"])),
                    )
                )
                player_two_hit = (
                    room["players"][2]["jump_until"] <= time.monotonic()
                    and hit_trail(
                        room,
                        2,
                        ignore_recent=min(12, len(room["players"][2]["trails"])),
                    )
                )

                if player_one_hit:
                    room["winner"] = room["players"][2]["name"]
                    room["players"][1]["game_over"] = True
                if player_two_hit:
                    room["winner"] = room["players"][1]["name"]
                    room["players"][2]["game_over"] = True

            if should_emit_state:
                await emit_room_state(room)


@fastapi_app.on_event("startup")
async def start_game_loop():
    sio.start_background_task(game_loop)

fastapi_app.mount("/", StaticFiles(directory=frontend_dist), name="frontend")

app = socketio.ASGIApp(sio, fastapi_app, socketio_path="socket.io")