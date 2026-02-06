#!/usr/bin/env python3
"""
Chess Online - Serveur HTTP + WebSocket (aiohttp)
Sert le frontend et gère les salons de jeu sur un seul port.
Compatible avec les plateformes cloud (Render, Railway, Fly.io).
"""

import asyncio
import json
import os
import random
import string
from pathlib import Path

from aiohttp import web

# --- Configuration ---
PORT = int(os.environ.get("PORT", 8080))
STATIC_DIR = Path(__file__).parent / "static"

# --- Rooms ---
rooms = {}  # room_id -> Room


class Room:
    """Représente un salon de jeu avec deux joueurs."""
    def __init__(self, room_id, host_ws, time_limit=300):
        self.room_id = room_id
        self.players = {host_ws: None}  # ws -> color
        self.host = host_ws
        self.guest = None
        self.started = False
        self.time_limit = time_limit  # 0 = sans timer

    def is_full(self):
        return len(self.players) == 2

    def add_guest(self, ws):
        self.guest = ws
        self.players[ws] = None

    def assign_colors(self):
        """Assigne aléatoirement blanc/noir aux deux joueurs."""
        if random.random() < 0.5:
            self.players[self.host] = "white"
            self.players[self.guest] = "black"
        else:
            self.players[self.host] = "black"
            self.players[self.guest] = "white"
        self.started = True

    def get_opponent(self, ws):
        for player in self.players:
            if player != ws:
                return player
        return None

    def get_color(self, ws):
        return self.players.get(ws)

    def remove_player(self, ws):
        if ws in self.players:
            del self.players[ws]


def generate_room_id():
    """Génère un code de salon court et lisible."""
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=5))


# --- WebSocket handler ---
async def websocket_handler(request):
    """Gère la connexion WebSocket d'un joueur."""
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    current_room = None

    try:
        async for raw_message in ws:
            if raw_message.type == web.WSMsgType.TEXT:
                try:
                    msg = json.loads(raw_message.data)
                except json.JSONDecodeError:
                    await ws.send_json({
                        "type": "error",
                        "message": "Message JSON invalide"
                    })
                    continue

                msg_type = msg.get("type")

                if msg_type == "create_room":
                    room_id = generate_room_id()
                    while room_id in rooms:
                        room_id = generate_room_id()

                    time_limit = msg.get("time", 300)
                    room = Room(room_id, ws, time_limit)
                    rooms[room_id] = room
                    current_room = room

                    await ws.send_json({
                        "type": "room_created",
                        "room_id": room_id
                    })

                elif msg_type == "join_room":
                    room_id = msg.get("room_id", "").upper().strip()

                    if room_id not in rooms:
                        await ws.send_json({
                            "type": "error",
                            "message": f"Salon '{room_id}' introuvable"
                        })
                        continue

                    room = rooms[room_id]
                    if room.is_full():
                        await ws.send_json({
                            "type": "error",
                            "message": "Le salon est complet"
                        })
                        continue

                    room.add_guest(ws)
                    current_room = room

                    room.assign_colors()

                    for player_ws, color in room.players.items():
                        await player_ws.send_json({
                            "type": "game_start",
                            "color": color,
                            "room_id": room_id,
                            "time": room.time_limit
                        })

                elif msg_type == "move":
                    if current_room and current_room.started:
                        opponent = current_room.get_opponent(ws)
                        if opponent:
                            move_msg = {
                                "type": "move",
                                "from": msg["from"],
                                "to": msg["to"],
                                "promotion": msg.get("promotion")
                            }
                            if "white_time" in msg:
                                move_msg["white_time"] = msg["white_time"]
                                move_msg["black_time"] = msg["black_time"]
                            await opponent.send_json(move_msg)

                elif msg_type == "timeout":
                    if current_room and current_room.started:
                        opponent = current_room.get_opponent(ws)
                        loser = msg.get("loser", "")
                        winner = "black" if loser == "white" else "white"
                        if opponent:
                            await opponent.send_json({
                                "type": "timeout",
                                "winner": winner
                            })

                elif msg_type == "resign":
                    if current_room and current_room.started:
                        opponent = current_room.get_opponent(ws)
                        if opponent:
                            await opponent.send_json({
                                "type": "opponent_resigned"
                            })

                elif msg_type == "chat":
                    if current_room and current_room.started:
                        opponent = current_room.get_opponent(ws)
                        if opponent:
                            await opponent.send_json({
                                "type": "chat",
                                "message": msg.get("message", "")
                            })

            elif raw_message.type in (web.WSMsgType.ERROR, web.WSMsgType.CLOSE):
                break

    except Exception:
        pass
    finally:
        if current_room:
            opponent = current_room.get_opponent(ws)
            current_room.remove_player(ws)

            if opponent:
                try:
                    await opponent.send_json({
                        "type": "opponent_disconnected"
                    })
                except Exception:
                    pass

            if len(current_room.players) == 0:
                rooms.pop(current_room.room_id, None)

    return ws


# --- Health check ---
async def health_handler(request):
    return web.Response(text="OK")


# --- App factory ---
def create_app():
    app = web.Application()
    app.router.add_get("/ws", websocket_handler)
    app.router.add_get("/health", health_handler)
    app.router.add_static("/", STATIC_DIR, show_index=True)
    return app


if __name__ == "__main__":
    print("=" * 50)
    print("  ♛  CHESS ONLINE - Serveur  ♛")
    print("=" * 50)
    print(f"  http://localhost:{PORT}")
    print("=" * 50)
    print("  Ctrl+C pour arrêter")
    print()

    app = create_app()
    web.run_app(app, host="0.0.0.0", port=PORT, print=None)
