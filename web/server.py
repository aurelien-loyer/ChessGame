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
import shutil
from pathlib import Path

from aiohttp import web

# --- Stockfish Engine (python-chess) ---
import chess
import chess.engine

STOCKFISH_PATH = shutil.which("stockfish") or "/usr/games/stockfish"

# --- Configuration ---
PORT = int(os.environ.get("PORT", 8080))
STATIC_DIR = Path(__file__).parent / "static"

# --- Rooms ---
rooms = {}  # room_id -> Room

# --- Matchmaking Queue ---
# time_limit -> list of (ws, asyncio.Future)
matchmaking_queue = {}
matchmaking_lock = asyncio.Lock()


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
    ws = web.WebSocketResponse(
        heartbeat=20,        # Server sends ping every 20s
        autoping=True,       # Auto-respond to client pings
    )
    await ws.prepare(request)

    current_room = None
    in_matchmaking = False

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

                elif msg_type == "matchmaking_join":
                    time_limit = msg.get("time", 300)
                    in_matchmaking = True

                    async with matchmaking_lock:
                        queue = matchmaking_queue.setdefault(time_limit, [])

                        # Clean stale entries (closed connections)
                        queue[:] = [(w, f) for w, f in queue if not w.closed and not f.done()]

                        # Check if someone is already waiting with same time
                        if queue:
                            opponent_ws, opponent_future = queue.pop(0)

                            # Verify opponent is still connected
                            if opponent_ws.closed:
                                # Opponent gone, add self to queue
                                future = asyncio.get_event_loop().create_future()
                                queue.append((ws, future))

                                await ws.send_json({
                                    "type": "matchmaking_waiting",
                                    "queue_size": len(queue)
                                })
                            else:
                                # Match found! Create a room
                                room_id = generate_room_id()
                                while room_id in rooms:
                                    room_id = generate_room_id()

                                room = Room(room_id, opponent_ws, time_limit)
                                room.add_guest(ws)
                                rooms[room_id] = room
                                current_room = room

                                room.assign_colors()
                                in_matchmaking = False

                                # Notify both players
                                for player_ws, color in room.players.items():
                                    try:
                                        await player_ws.send_json({
                                            "type": "game_start",
                                            "color": color,
                                            "room_id": room_id,
                                            "time": room.time_limit,
                                            "matchmade": True
                                        })
                                    except Exception:
                                        pass

                                # Resolve the opponent's future so they know
                                if not opponent_future.done():
                                    opponent_future.set_result(room)
                        else:
                            # No one waiting, add to queue
                            future = asyncio.get_event_loop().create_future()
                            queue.append((ws, future))

                            await ws.send_json({
                                "type": "matchmaking_waiting",
                                "queue_size": len(queue)
                            })

                            # Wait for match asynchronously (non-blocking)
                            # The match will be resolved by the next player joining

                elif msg_type == "matchmaking_cancel":
                    in_matchmaking = False
                    async with matchmaking_lock:
                        for time_limit, queue in matchmaking_queue.items():
                            queue[:] = [(w, f) for w, f in queue if w != ws]

                    await ws.send_json({
                        "type": "matchmaking_cancelled"
                    })

                elif msg_type == "ping":
                    # Client heartbeat — respond with pong
                    try:
                        await ws.send_json({"type": "pong"})
                    except Exception:
                        pass

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

                elif msg_type == "reconnect":
                    # Client tries to rejoin a room after connection drop
                    room_id = msg.get("room_id", "").upper().strip()
                    color = msg.get("color")
                    if room_id in rooms:
                        room = rooms[room_id]
                        # Find the disconnected player slot and replace ws
                        old_ws = None
                        for p_ws, p_color in list(room.players.items()):
                            if p_color == color:
                                old_ws = p_ws
                                break
                        if old_ws:
                            # Swap ws reference
                            room.players[ws] = color
                            if old_ws in room.players:
                                del room.players[old_ws]
                            if room.host == old_ws:
                                room.host = ws
                            if room.guest == old_ws:
                                room.guest = ws
                            current_room = room
                            in_matchmaking = False
                            # Notify opponent about reconnection
                            opponent = room.get_opponent(ws)
                            if opponent and not opponent.closed:
                                try:
                                    await opponent.send_json({
                                        "type": "opponent_reconnected"
                                    })
                                except Exception:
                                    pass
                            await ws.send_json({
                                "type": "reconnected",
                                "room_id": room_id,
                                "color": color,
                                "time": room.time_limit
                            })
                        else:
                            await ws.send_json({
                                "type": "reconnect_failed",
                                "reason": "Color slot not found"
                            })
                    else:
                        await ws.send_json({
                            "type": "reconnect_failed",
                            "reason": "Room not found"
                        })

                elif msg_type == "sync_request":
                    # Opponent requests full move history to resync
                    if current_room and current_room.started:
                        opponent = current_room.get_opponent(ws)
                        if opponent and not opponent.closed:
                            try:
                                await opponent.send_json({
                                    "type": "sync_request"
                                })
                            except Exception:
                                pass

                elif msg_type == "sync_state":
                    # Forward full game state to opponent (for resync)
                    if current_room and current_room.started:
                        opponent = current_room.get_opponent(ws)
                        if opponent and not opponent.closed:
                            try:
                                await opponent.send_json({
                                    "type": "sync_state",
                                    "moves": msg.get("moves", []),
                                    "white_time": msg.get("white_time"),
                                    "black_time": msg.get("black_time")
                                })
                            except Exception:
                                pass

            elif raw_message.type in (web.WSMsgType.ERROR, web.WSMsgType.CLOSE):
                break

    except Exception:
        pass
    finally:
        # Remove from matchmaking queue if needed
        if in_matchmaking:
            async with matchmaking_lock:
                for time_limit, queue in matchmaking_queue.items():
                    queue[:] = [(w, f) for w, f in queue if w != ws]

        if current_room and current_room.started:
            # Game in progress — don't destroy room, allow reconnection
            opponent = current_room.get_opponent(ws)
            if opponent and not opponent.closed:
                try:
                    await opponent.send_json({
                        "type": "opponent_disconnected"
                    })
                except Exception:
                    pass

            # Schedule room cleanup after 120s if player doesn't reconnect
            room_id = current_room.room_id
            disconnected_color = current_room.get_color(ws)

            async def _delayed_cleanup():
                await asyncio.sleep(120)
                if room_id in rooms:
                    room = rooms[room_id]
                    # Check if the disconnected player is still gone
                    still_gone = True
                    for p_ws, p_color in room.players.items():
                        if p_color == disconnected_color and not p_ws.closed:
                            still_gone = False
                            break
                    if still_gone:
                        # Notify remaining player
                        for p_ws in list(room.players.keys()):
                            if not p_ws.closed:
                                try:
                                    await p_ws.send_json({
                                        "type": "opponent_disconnected_final"
                                    })
                                except Exception:
                                    pass
                        rooms.pop(room_id, None)

            asyncio.ensure_future(_delayed_cleanup())

        elif current_room:
            # Game not started — clean up immediately
            opponent = current_room.get_opponent(ws)
            current_room.remove_player(ws)

            if opponent and not opponent.closed:
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


# --- Stockfish AI endpoint ---
# Engine pool to reuse Stockfish processes
_engine_lock = asyncio.Lock()
_engine_instance = None


async def _get_engine():
    """Get or create a persistent Stockfish engine instance."""
    global _engine_instance
    if _engine_instance is not None:
        return _engine_instance
    try:
        transport, engine = await chess.engine.popen_uci(STOCKFISH_PATH)
        # Configure for maximum strength
        await engine.configure({
            "Threads": 1,
            "Hash": 64,
        })
        _engine_instance = engine
        print(f"[STOCKFISH] Engine started: {STOCKFISH_PATH}")
        return engine
    except Exception as e:
        print(f"[STOCKFISH] Failed to start engine: {e}")
        return None


async def ai_move_handler(request):
    """
    POST /api/ai-move
    Body: { "fen": "...", "difficulty": 3|4|5 }
    Returns: { "move": "e2e4", "eval": 0.5, "depth": 20 }

    Difficulty mapping:
      3 (Hard)    — Skill 5,  depth 12, time 1s
      4 (Expert)  — Skill 14, depth 18, time 3s
      5 (GM)      — Skill 20, depth 25, time 10s, full NNUE strength
    """
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    fen = data.get("fen")
    difficulty = data.get("difficulty", 5)

    if not fen:
        return web.json_response({"error": "Missing fen"}, status=400)

    try:
        board = chess.Board(fen)
    except Exception:
        return web.json_response({"error": "Invalid FEN"}, status=400)

    if board.is_game_over():
        return web.json_response({"error": "Game is over"}, status=400)

    # Configure search parameters per difficulty
    if difficulty <= 3:
        limit = chess.engine.Limit(depth=12, time=1.0)
        skill_level = 5
    elif difficulty == 4:
        limit = chess.engine.Limit(depth=18, time=3.0)
        skill_level = 14
    else:
        # Grand Maître — full strength, deep search, long time
        limit = chess.engine.Limit(depth=25, time=10.0)
        skill_level = 20

    async with _engine_lock:
        engine = await _get_engine()
        if engine is None:
            return web.json_response(
                {"error": "Stockfish engine not available"},
                status=503
            )

        try:
            # Set skill level
            await engine.configure({"Skill Level": skill_level})

            # Find the best move
            result = await engine.play(board, limit)
            move_uci = result.move.uci() if result.move else None

            if not move_uci:
                return web.json_response({"error": "No move found"}, status=500)

            # Get evaluation info
            info = await engine.analyse(board, chess.engine.Limit(depth=min(12, limit.depth or 12), time=0.5))
            score = info.get("score")
            eval_cp = None
            eval_mate = None
            if score:
                pov = score.relative
                if pov.is_mate():
                    eval_mate = pov.mate()
                else:
                    eval_cp = pov.score()

            response = {
                "move": move_uci,
                "depth": info.get("depth", 0),
            }
            if eval_cp is not None:
                response["eval"] = eval_cp / 100.0
            if eval_mate is not None:
                response["mate"] = eval_mate

            return web.json_response(response)

        except Exception as e:
            print(f"[STOCKFISH] Error during search: {e}")
            # Engine might be dead, reset it
            global _engine_instance
            try:
                await engine.quit()
            except Exception:
                pass
            _engine_instance = None
            return web.json_response(
                {"error": "Engine error, please retry"},
                status=500
            )


# --- Index page ---
async def index_handler(request):
    return web.FileResponse(STATIC_DIR / "index.html")


# --- App factory ---
def create_app():
    app = web.Application()
    app.router.add_get("/health", health_handler)
    app.router.add_post("/api/ai-move", ai_move_handler)
    app.router.add_get("/ws", websocket_handler)
    app.router.add_get("/", index_handler)
    app.router.add_static("/", STATIC_DIR, show_index=False)
    return app


if __name__ == "__main__":
    print("=" * 50)
    print("  ♛  CHESS ONLINE - Serveur  ♛")
    print("=" * 50)
    print(f"  PORT detected: {PORT}")
    print(f"  Binding to: http://0.0.0.0:{PORT}")
    print("=" * 50)
    print()
    print("Application loading")
    print()

    app = create_app()
    web.run_app(
        app, 
        host="0.0.0.0", 
        port=PORT,
        print=lambda x: print(f"[SERVER] {x}") if x else None,
        access_log=None
    )
