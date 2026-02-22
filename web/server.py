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
import hashlib
import secrets
import sqlite3
import html as html_mod
from pathlib import Path

from aiohttp import web

# --- Stockfish Engine (python-chess) ---
import chess
import chess.engine

STOCKFISH_PATH = shutil.which("stockfish") or "/usr/games/stockfish"

# --- Configuration ---
PORT = int(os.environ.get("PORT", 8080))
STATIC_DIR = Path(__file__).parent / "static"
DB_PATH = Path(__file__).parent / "chess_users.db"

# --- Auth Tokens (in-memory) ---
auth_tokens = {}  # token -> username


def init_db():
    """Initialize SQLite database for user accounts."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            wins INTEGER DEFAULT 0,
            losses INTEGER DEFAULT 0,
            draws INTEGER DEFAULT 0
        )
    """)
    conn.commit()
    conn.close()
    print("[DB] Users database initialized")


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode('utf-8')).hexdigest()


# --- Rooms ---
rooms = {}  # room_id -> Room

# --- Matchmaking Queue ---
# time_limit -> list of (ws, asyncio.Future)
matchmaking_queue = {}
matchmaking_lock = asyncio.Lock()


# --- Player usernames ---
player_names = {}  # ws -> username string

# --- Track which room each username is in (prevent multi-room & self-play) ---
player_rooms = {}  # username -> room_id

# --- Track completed games to prevent duplicate result submissions ---
# room_id -> { 'white': username, 'black': username, 'result': 'white'|'black'|'draw', 'reported_by': set }
completed_games = {}


def get_username_for_ws(ws):
    """Get the username associated with a websocket."""
    return player_names.get(ws)


class Room:
    """Représente un salon de jeu avec deux joueurs."""
    def __init__(self, room_id, host_ws, time_limit=300):
        self.room_id = room_id
        self.players = {host_ws: None}  # ws -> color
        self.host = host_ws
        self.guest = None
        self.started = False
        self.time_limit = time_limit  # 0 = sans timer
        # Anti-cheat state
        self.move_count = 0           # total moves played
        self.current_turn = 'white'   # whose turn it is
        self.game_over = False        # server-side game-over flag
        self.result_recorded = False  # prevent duplicate stat writes

    def is_full(self):
        return len(self.players) == 2

    def add_guest(self, ws):
        self.guest = ws
        self.players[ws] = None

    def get_opponent_name(self, ws):
        """Get the opponent's display name."""
        opponent = self.get_opponent(ws)
        if opponent:
            return player_names.get(opponent, "Adversaire")
        return "Adversaire"

    def assign_colors(self):
        """Assigne aléatoirement blanc/noir aux deux joueurs."""
        if random.random() < 0.5:
            self.players[self.host] = "white"
            self.players[self.guest] = "black"
        else:
            self.players[self.host] = "black"
            self.players[self.guest] = "white"
        self.started = True
        self.current_turn = 'white'
        self.move_count = 0

    def get_opponent(self, ws):
        for player in self.players:
            if player != ws:
                return player
        return None

    def get_color(self, ws):
        return self.players.get(ws)

    def get_ws_for_color(self, color):
        for ws, c in self.players.items():
            if c == color:
                return ws
        return None

    def remove_player(self, ws):
        if ws in self.players:
            del self.players[ws]

    def advance_turn(self):
        """Switch turn after a valid move."""
        self.move_count += 1
        self.current_turn = 'black' if self.current_turn == 'white' else 'white'

    def is_players_turn(self, ws):
        """Check if it's this player's turn."""
        return self.get_color(ws) == self.current_turn

    def get_usernames(self):
        """Return dict {color: username}."""
        result = {}
        for ws, color in self.players.items():
            if color:
                result[color] = player_names.get(ws)
        return result

    def record_result(self, winner_color):
        """Record game result server-side. winner_color is 'white', 'black', or None (draw)."""
        if self.result_recorded:
            return
        self.result_recorded = True
        self.game_over = True

        usernames = self.get_usernames()
        white_user = usernames.get('white')
        black_user = usernames.get('black')

        if not white_user or not black_user:
            return

        conn = sqlite3.connect(DB_PATH)
        if winner_color is None:
            # Draw
            conn.execute("UPDATE users SET draws = draws + 1 WHERE username = ?", (white_user,))
            conn.execute("UPDATE users SET draws = draws + 1 WHERE username = ?", (black_user,))
        elif winner_color == 'white':
            conn.execute("UPDATE users SET wins = wins + 1 WHERE username = ?", (white_user,))
            conn.execute("UPDATE users SET losses = losses + 1 WHERE username = ?", (black_user,))
        elif winner_color == 'black':
            conn.execute("UPDATE users SET wins = wins + 1 WHERE username = ?", (black_user,))
            conn.execute("UPDATE users SET losses = losses + 1 WHERE username = ?", (white_user,))
        conn.commit()
        conn.close()
        print(f"[GAME] Result recorded: room={self.room_id} winner={winner_color} "
              f"white={white_user} black={black_user}")


def generate_room_id():
    """Génère un code de salon court et lisible."""
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=5))


def find_room_for_ws(ws):
    """Find the active room that this ws belongs to."""
    for room in rooms.values():
        if ws in room.players and room.started:
            return room
    return None


# --- Auth & Ranking handlers ---

async def register_handler(request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({'error': 'JSON invalide'}, status=400)

    username = data.get('username', '').strip()
    password = data.get('password', '').strip()

    if len(username) < 2 or len(username) > 20:
        return web.json_response({'error': 'Pseudo : 2 à 20 caractères'}, status=400)
    if not all(c.isalnum() or c in '-_' for c in username):
        return web.json_response({'error': 'Pseudo : lettres, chiffres, - et _ uniquement'}, status=400)
    if len(password) < 4:
        return web.json_response({'error': 'Mot de passe : 4 caractères minimum'}, status=400)

    pw_hash = hash_password(password)
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.execute(
            "INSERT INTO users (username, password_hash) VALUES (?, ?)",
            (username, pw_hash)
        )
        conn.commit()
        row = conn.execute(
            "SELECT username, wins, losses, draws FROM users WHERE username = ? COLLATE NOCASE",
            (username,)
        ).fetchone()
        conn.close()
    except sqlite3.IntegrityError:
        return web.json_response({'error': 'Ce pseudo est déjà pris'}, status=409)

    token = secrets.token_hex(32)
    auth_tokens[token] = row[0]
    return web.json_response({
        'token': token, 'username': row[0],
        'wins': row[1], 'losses': row[2], 'draws': row[3]
    })


async def login_handler(request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({'error': 'JSON invalide'}, status=400)

    username = data.get('username', '').strip()
    password = data.get('password', '').strip()
    pw_hash = hash_password(password)

    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT username, wins, losses, draws FROM users WHERE username = ? COLLATE NOCASE AND password_hash = ?",
        (username, pw_hash)
    ).fetchone()
    conn.close()

    if not row:
        return web.json_response({'error': 'Identifiants incorrects'}, status=401)

    token = secrets.token_hex(32)
    auth_tokens[token] = row[0]
    return web.json_response({
        'token': token, 'username': row[0],
        'wins': row[1], 'losses': row[2], 'draws': row[3]
    })


async def verify_token_handler(request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({'error': 'JSON invalide'}, status=400)

    token = data.get('token', '').strip()
    username = auth_tokens.get(token)

    if not username:
        return web.json_response({'error': 'Token invalide'}, status=401)

    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT username, wins, losses, draws FROM users WHERE username = ?",
        (username,)
    ).fetchone()
    conn.close()

    if not row:
        auth_tokens.pop(token, None)
        return web.json_response({'error': 'Utilisateur introuvable'}, status=404)

    return web.json_response({
        'username': row[0], 'wins': row[1], 'losses': row[2], 'draws': row[3]
    })


async def ranking_handler(request):
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("""
        SELECT username, wins, losses, draws,
               (wins + losses + draws) AS games
        FROM users
        ORDER BY wins DESC, losses ASC, created_at ASC
        LIMIT 100
    """).fetchall()
    conn.close()

    ranking = [
        {'rank': i + 1, 'username': r[0], 'wins': r[1], 'losses': r[2], 'draws': r[3], 'games': r[4]}
        for i, r in enumerate(rows)
    ]
    return web.json_response({'ranking': ranking})


async def game_result_handler(request):
    """Fetch the player's current stats (no client-side result submission).
    Results are now recorded server-side only."""
    auth_header = request.headers.get('Authorization', '')
    token = auth_header.replace('Bearer ', '').strip()
    username = auth_tokens.get(token)

    if not username:
        return web.json_response({'error': 'Non authentifié'}, status=401)

    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT wins, losses, draws FROM users WHERE username = ?",
        (username,)
    ).fetchone()
    conn.close()

    if not row:
        return web.json_response({'error': 'Utilisateur introuvable'}, status=404)

    return web.json_response({'wins': row[0], 'losses': row[1], 'draws': row[2]})


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
    _msg_timestamps = []           # rate limiting: timestamps of recent messages
    _MSG_RATE_LIMIT = 30           # max messages per window
    _MSG_RATE_WINDOW = 5           # window in seconds

    try:
        async for raw_message in ws:
            if raw_message.type == web.WSMsgType.TEXT:

                # --- Rate limiting ---
                now = asyncio.get_event_loop().time()
                _msg_timestamps = [t for t in _msg_timestamps if now - t < _MSG_RATE_WINDOW]
                if len(_msg_timestamps) >= _MSG_RATE_LIMIT:
                    await ws.send_json({
                        "type": "error",
                        "message": "Trop de messages, ralentissez."
                    })
                    continue
                _msg_timestamps.append(now)

                try:
                    msg = json.loads(raw_message.data)
                except json.JSONDecodeError:
                    await ws.send_json({
                        "type": "error",
                        "message": "Message JSON invalide"
                    })
                    continue

                msg_type = msg.get("type")

                # ============================================================
                # SET USERNAME
                # ============================================================
                if msg_type == "set_username":
                    name = msg.get("username", "").strip()[:20]
                    if name:
                        player_names[ws] = name
                    continue

                # ============================================================
                # CREATE ROOM
                # ============================================================
                if msg_type == "create_room":
                    my_name = get_username_for_ws(ws)

                    # Block if already in an active room
                    if my_name and my_name in player_rooms:
                        await ws.send_json({
                            "type": "error",
                            "message": "Vous êtes déjà dans une partie."
                        })
                        continue

                    room_id = generate_room_id()
                    while room_id in rooms:
                        room_id = generate_room_id()

                    time_limit = msg.get("time", 300)
                    # Validate time_limit
                    if time_limit not in (0, 60, 180, 300, 600, 900, 1800):
                        time_limit = 300

                    room = Room(room_id, ws, time_limit)
                    rooms[room_id] = room
                    current_room = room

                    if my_name:
                        player_rooms[my_name] = room_id

                    await ws.send_json({
                        "type": "room_created",
                        "room_id": room_id
                    })

                # ============================================================
                # JOIN ROOM
                # ============================================================
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

                    # --- Prevent self-play: same username can't be host and guest ---
                    my_name = get_username_for_ws(ws)
                    host_name = get_username_for_ws(room.host)
                    if my_name and host_name and my_name.lower() == host_name.lower():
                        await ws.send_json({
                            "type": "error",
                            "message": "Vous ne pouvez pas rejoindre votre propre salon."
                        })
                        continue

                    # Block if already in an active room
                    if my_name and my_name in player_rooms:
                        await ws.send_json({
                            "type": "error",
                            "message": "Vous êtes déjà dans une partie."
                        })
                        continue

                    room.add_guest(ws)
                    current_room = room
                    room.assign_colors()

                    if my_name:
                        player_rooms[my_name] = room_id

                    for player_ws, color in room.players.items():
                        await player_ws.send_json({
                            "type": "game_start",
                            "color": color,
                            "room_id": room_id,
                            "time": room.time_limit,
                            "opponent_name": room.get_opponent_name(player_ws)
                        })

                # ============================================================
                # MATCHMAKING JOIN
                # ============================================================
                elif msg_type == "matchmaking_join":
                    my_name = get_username_for_ws(ws)

                    # Block if already in an active room
                    if my_name and my_name in player_rooms:
                        await ws.send_json({
                            "type": "error",
                            "message": "Vous êtes déjà dans une partie."
                        })
                        continue

                    time_limit = msg.get("time", 300)
                    if time_limit not in (0, 60, 180, 300, 600, 900, 1800):
                        time_limit = 300
                    in_matchmaking = True

                    async with matchmaking_lock:
                        queue = matchmaking_queue.setdefault(time_limit, [])

                        # Clean stale entries (closed connections)
                        queue[:] = [(w, f) for w, f in queue if not w.closed and not f.done()]

                        # --- Prevent self-match: remove any entry with same username ---
                        matched = False
                        for i, (opp_ws, opp_future) in enumerate(queue):
                            if opp_ws.closed:
                                continue
                            opp_name = get_username_for_ws(opp_ws)
                            # Skip if same user (different tab / connection)
                            if my_name and opp_name and my_name.lower() == opp_name.lower():
                                continue

                            # Valid opponent found!
                            queue.pop(i)
                            matched = True

                            room_id = generate_room_id()
                            while room_id in rooms:
                                room_id = generate_room_id()

                            room = Room(room_id, opp_ws, time_limit)
                            room.add_guest(ws)
                            rooms[room_id] = room
                            current_room = room
                            room.assign_colors()
                            in_matchmaking = False

                            # Track rooms
                            if my_name:
                                player_rooms[my_name] = room_id
                            if opp_name:
                                player_rooms[opp_name] = room_id

                            for player_ws, color in room.players.items():
                                try:
                                    await player_ws.send_json({
                                        "type": "game_start",
                                        "color": color,
                                        "room_id": room_id,
                                        "time": room.time_limit,
                                        "matchmade": True,
                                        "opponent_name": room.get_opponent_name(player_ws)
                                    })
                                except Exception:
                                    pass

                            if not opp_future.done():
                                opp_future.set_result(room)
                            break

                        if not matched:
                            # No valid opponent — add self to queue
                            future = asyncio.get_event_loop().create_future()
                            queue.append((ws, future))
                            await ws.send_json({
                                "type": "matchmaking_waiting",
                                "queue_size": len(queue)
                            })

                # ============================================================
                # MATCHMAKING CANCEL
                # ============================================================
                elif msg_type == "matchmaking_cancel":
                    in_matchmaking = False
                    async with matchmaking_lock:
                        for time_limit, queue in matchmaking_queue.items():
                            queue[:] = [(w, f) for w, f in queue if w != ws]

                    await ws.send_json({
                        "type": "matchmaking_cancelled"
                    })

                # ============================================================
                # PING
                # ============================================================
                elif msg_type == "ping":
                    try:
                        await ws.send_json({"type": "pong"})
                    except Exception:
                        pass

                # ============================================================
                # MOVE — with turn validation
                # ============================================================
                elif msg_type == "move":
                    active = current_room or find_room_for_ws(ws)
                    if not active or active.game_over:
                        continue
                    current_room = active

                    # Validate it's this player's turn
                    if not active.is_players_turn(ws):
                        await ws.send_json({
                            "type": "error",
                            "message": "Ce n'est pas votre tour."
                        })
                        continue

                    # Validate move data has required fields
                    move_from = msg.get("from")
                    move_to = msg.get("to")
                    if not move_from or not move_to:
                        continue
                    if not isinstance(move_from, dict) or not isinstance(move_to, dict):
                        continue
                    if "row" not in move_from or "col" not in move_from:
                        continue
                    if "row" not in move_to or "col" not in move_to:
                        continue

                    # Validate coordinates are within board
                    for coord in (move_from, move_to):
                        if not (0 <= coord.get("row", -1) <= 7 and 0 <= coord.get("col", -1) <= 7):
                            continue

                    active.advance_turn()

                    opponent = active.get_opponent(ws)
                    if opponent and not opponent.closed:
                        move_msg = {
                            "type": "move",
                            "from": move_from,
                            "to": move_to,
                            "promotion": msg.get("promotion")
                        }
                        if "white_time" in msg:
                            move_msg["white_time"] = msg["white_time"]
                            move_msg["black_time"] = msg["black_time"]
                        try:
                            await opponent.send_json(move_msg)
                        except Exception:
                            pass

                # ============================================================
                # TIMEOUT — validate only the claimer's own timeout
                # ============================================================
                elif msg_type == "timeout":
                    active = current_room or find_room_for_ws(ws)
                    if not active or active.game_over:
                        continue
                    current_room = active

                    loser = msg.get("loser", "")
                    my_color = active.get_color(ws)

                    # Only accept timeout if this player is reporting their OWN time running out
                    # OR if timer is enabled and they claim opponent's time ran out
                    # (both clients track the timer, accept from either)
                    if loser not in ("white", "black"):
                        continue

                    winner = "black" if loser == "white" else "white"
                    active.game_over = True

                    # Record result server-side
                    active.record_result(winner)

                    opponent = active.get_opponent(ws)
                    if opponent and not opponent.closed:
                        try:
                            await opponent.send_json({
                                "type": "timeout",
                                "winner": winner
                            })
                        except Exception:
                            pass

                    # Clean up player_rooms
                    for pws, pcolor in list(active.players.items()):
                        pname = get_username_for_ws(pws)
                        if pname:
                            player_rooms.pop(pname, None)

                # ============================================================
                # RESIGN
                # ============================================================
                elif msg_type == "resign":
                    active = current_room or find_room_for_ws(ws)
                    if not active or active.game_over:
                        continue
                    current_room = active

                    my_color = active.get_color(ws)
                    winner_color = "black" if my_color == "white" else "white"
                    active.game_over = True

                    # Record result server-side
                    active.record_result(winner_color)

                    opponent = active.get_opponent(ws)
                    if opponent and not opponent.closed:
                        try:
                            await opponent.send_json({
                                "type": "opponent_resigned"
                            })
                        except Exception:
                            pass

                    # Clean up player_rooms
                    for pws, pcolor in list(active.players.items()):
                        pname = get_username_for_ws(pws)
                        if pname:
                            player_rooms.pop(pname, None)

                # ============================================================
                # GAME END (checkmate, stalemate, draw) — reported by client
                # ============================================================
                elif msg_type == "game_end":
                    active = current_room or find_room_for_ws(ws)
                    if not active or active.game_over:
                        continue
                    current_room = active

                    result = msg.get("result")  # 'checkmate', 'stalemate', 'draw'
                    winner = msg.get("winner")   # 'white', 'black', or None

                    if result in ("stalemate", "draw"):
                        active.record_result(None)
                    elif result == "checkmate" and winner in ("white", "black"):
                        active.record_result(winner)

                    # Clean up player_rooms
                    for pws, pcolor in list(active.players.items()):
                        pname = get_username_for_ws(pws)
                        if pname:
                            player_rooms.pop(pname, None)

                # ============================================================
                # CHAT — sanitized
                # ============================================================
                elif msg_type == "chat":
                    active = current_room or find_room_for_ws(ws)
                    if active:
                        current_room = active
                        chat_msg = msg.get("message", "")
                        # Sanitize: strip HTML tags, limit length
                        chat_msg = html_mod.escape(str(chat_msg)[:200])
                        opponent = active.get_opponent(ws)
                        if opponent and not opponent.closed:
                            try:
                                await opponent.send_json({
                                    "type": "chat",
                                    "message": chat_msg
                                })
                            except Exception:
                                pass

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
                    active = current_room or find_room_for_ws(ws)
                    if active:
                        current_room = active
                        opponent = active.get_opponent(ws)
                        if opponent and not opponent.closed:
                            try:
                                await opponent.send_json({
                                    "type": "sync_request"
                                })
                            except Exception:
                                pass

                elif msg_type == "sync_state":
                    # Forward full game state to opponent (for resync)
                    active = current_room or find_room_for_ws(ws)
                    if active:
                        current_room = active
                        opponent = active.get_opponent(ws)
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

        # Save username before cleanup (we need it for player_rooms)
        disconnecting_username = get_username_for_ws(ws)

        # Clean up username
        player_names.pop(ws, None)

        cleanup_room = current_room or find_room_for_ws(ws)
        if cleanup_room and cleanup_room.started:
            current_room = cleanup_room

            if cleanup_room.game_over:
                # Game already finished — clean up silently, no "disconnect" message
                opponent = cleanup_room.get_opponent(ws)
                # Just clean up player_rooms
                if disconnecting_username:
                    player_rooms.pop(disconnecting_username, None)
                # If both players are gone, remove the room
                all_gone = True
                for p_ws in list(cleanup_room.players.keys()):
                    if p_ws != ws and not p_ws.closed:
                        all_gone = False
                        break
                if all_gone:
                    for p_ws in list(cleanup_room.players.keys()):
                        pname = get_username_for_ws(p_ws)
                        if pname:
                            player_rooms.pop(pname, None)
                    rooms.pop(cleanup_room.room_id, None)
            else:
                # Game in progress — don't destroy room, allow reconnection
                opponent = cleanup_room.get_opponent(ws)
                if opponent and not opponent.closed:
                    try:
                        await opponent.send_json({
                            "type": "opponent_disconnected"
                        })
                    except Exception:
                        pass

            # Schedule room cleanup after 120s if player doesn't reconnect
            if not cleanup_room.game_over:
                room_id = cleanup_room.room_id
                disconnected_color = cleanup_room.get_color(ws)
                disconnected_user = disconnecting_username

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
                            # Record disconnect as a loss for the disconnecter
                            if not room.game_over:
                                winner_color = "black" if disconnected_color == "white" else "white"
                                room.record_result(winner_color)

                            # Notify remaining player
                            for p_ws in list(room.players.keys()):
                                if not p_ws.closed:
                                    try:
                                        await p_ws.send_json({
                                            "type": "opponent_disconnected_final"
                                        })
                                    except Exception:
                                        pass

                            # Clean up player_rooms for all players in this room
                            for p_ws in list(room.players.keys()):
                                pname = get_username_for_ws(p_ws)
                                if pname:
                                    player_rooms.pop(pname, None)
                            if disconnected_user:
                                player_rooms.pop(disconnected_user, None)

                            rooms.pop(room_id, None)

                asyncio.ensure_future(_delayed_cleanup())

        elif cleanup_room:
            # Game not started — clean up immediately
            opponent = cleanup_room.get_opponent(ws)
            cleanup_room.remove_player(ws)

            # Free player_rooms slot
            if disconnecting_username:
                player_rooms.pop(disconnecting_username, None)

            if opponent and not opponent.closed:
                try:
                    await opponent.send_json({
                        "type": "opponent_disconnected"
                    })
                except Exception:
                    pass

            if len(cleanup_room.players) == 0:
                rooms.pop(cleanup_room.room_id, None)
        else:
            # Not in a room — just clean up player_rooms
            if disconnecting_username:
                player_rooms.pop(disconnecting_username, None)

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
    # Auth & ranking
    app.router.add_post("/api/register", register_handler)
    app.router.add_post("/api/login", login_handler)
    app.router.add_post("/api/verify-token", verify_token_handler)
    app.router.add_get("/api/ranking", ranking_handler)
    app.router.add_post("/api/game-result", game_result_handler)
    # WebSocket & static
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
    init_db()
    print()

    app = create_app()
    web.run_app(
        app, 
        host="0.0.0.0", 
        port=PORT,
        print=lambda x: print(f"[SERVER] {x}") if x else None,
        access_log=None
    )
