/**
 * ai.js — IA d'échecs hybride
 *
 * Architecture :
 *   - Niveaux 1-2 (Easy/Medium) : Minimax local (instantané)
 *   - Niveaux 3-5 (Hard/Expert/GM) : Stockfish WASM via Web Worker
 *
 * Stockfish est le moteur d'échecs le plus fort au monde (~3500+ ELO).
 * Il tourne intégralement dans le navigateur via WebAssembly.
 *
 * Mapping des niveaux vers Stockfish :
 *   HARD   (3) — Skill 5,  ELO 1600, depth 12, 1s
 *   EXPERT (4) — Skill 14, ELO 2200, depth 18, 3s
 *   GM     (5) — Skill 20, pleine force, depth 24, 10s
 */

const AI_DIFFICULTY = {
    EASY: 1,
    MEDIUM: 2,
    HARD: 3,
    EXPERT: 4,
    GRANDMASTER: 5
};

// ---- PST (pour minimax local niveaux 1-2) ----

const PAWN_TABLE = [
    [  0,  0,  0,  0,  0,  0,  0,  0 ],
    [ 50, 50, 50, 50, 50, 50, 50, 50 ],
    [ 10, 10, 20, 30, 30, 20, 10, 10 ],
    [  5,  5, 10, 25, 25, 10,  5,  5 ],
    [  0,  0,  0, 20, 20,  0,  0,  0 ],
    [  5, -5,-10,  0,  0,-10, -5,  5 ],
    [  5, 10, 10,-20,-20, 10, 10,  5 ],
    [  0,  0,  0,  0,  0,  0,  0,  0 ]
];

const KNIGHT_TABLE = [
    [-50,-40,-30,-30,-30,-30,-40,-50 ],
    [-40,-20,  0,  0,  0,  0,-20,-40 ],
    [-30,  0, 10, 15, 15, 10,  0,-30 ],
    [-30,  5, 15, 20, 20, 15,  5,-30 ],
    [-30,  0, 15, 20, 20, 15,  0,-30 ],
    [-30,  5, 10, 15, 15, 10,  5,-30 ],
    [-40,-20,  0,  5,  5,  0,-20,-40 ],
    [-50,-40,-30,-30,-30,-30,-40,-50 ]
];

const BISHOP_TABLE = [
    [-20,-10,-10,-10,-10,-10,-10,-20 ],
    [-10,  0,  0,  0,  0,  0,  0,-10 ],
    [-10,  0,  5, 10, 10,  5,  0,-10 ],
    [-10,  5,  5, 10, 10,  5,  5,-10 ],
    [-10,  0, 10, 10, 10, 10,  0,-10 ],
    [-10, 10, 10, 10, 10, 10, 10,-10 ],
    [-10,  5,  0,  0,  0,  0,  5,-10 ],
    [-20,-10,-10,-10,-10,-10,-10,-20 ]
];

const ROOK_TABLE = [
    [  0,  0,  0,  0,  0,  0,  0,  0 ],
    [  5, 10, 10, 10, 10, 10, 10,  5 ],
    [ -5,  0,  0,  0,  0,  0,  0, -5 ],
    [ -5,  0,  0,  0,  0,  0,  0, -5 ],
    [ -5,  0,  0,  0,  0,  0,  0, -5 ],
    [ -5,  0,  0,  0,  0,  0,  0, -5 ],
    [ -5,  0,  0,  0,  0,  0,  0, -5 ],
    [  0,  0,  0,  5,  5,  0,  0,  0 ]
];

const QUEEN_TABLE = [
    [-20,-10,-10, -5, -5,-10,-10,-20 ],
    [-10,  0,  0,  0,  0,  0,  0,-10 ],
    [-10,  0,  5,  5,  5,  5,  0,-10 ],
    [ -5,  0,  5,  5,  5,  5,  0, -5 ],
    [  0,  0,  5,  5,  5,  5,  0, -5 ],
    [-10,  5,  5,  5,  5,  5,  0,-10 ],
    [-10,  0,  5,  0,  0,  0,  0,-10 ],
    [-20,-10,-10, -5, -5,-10,-10,-20 ]
];

const KING_MG_TABLE = [
    [-30,-40,-40,-50,-50,-40,-40,-30 ],
    [-30,-40,-40,-50,-50,-40,-40,-30 ],
    [-30,-40,-40,-50,-50,-40,-40,-30 ],
    [-30,-40,-40,-50,-50,-40,-40,-30 ],
    [-20,-30,-30,-40,-40,-30,-30,-20 ],
    [-10,-20,-20,-20,-20,-20,-20,-10 ],
    [ 20, 20,  0,  0,  0,  0, 20, 20 ],
    [ 20, 30, 10,  0,  0, 10, 30, 20 ]
];

const PST = { P: PAWN_TABLE, N: KNIGHT_TABLE, B: BISHOP_TABLE, R: ROOK_TABLE, Q: QUEEN_TABLE, K: KING_MG_TABLE };
const PIECE_VALUES = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };

// ==========================================================================
// StockfishBridge — manages the Stockfish WASM Web Worker
// ==========================================================================
class StockfishBridge {
    constructor() {
        this.worker = null;
        this.ready = false;
        this.readyPromise = null;
        this._readyResolve = null;
        this._readyReject = null;
        this._searchResolve = null;
    }

    init() {
        if (this.readyPromise) return this.readyPromise;

        this.readyPromise = new Promise((resolve, reject) => {
            this._readyResolve = resolve;
            this._readyReject = reject;

            try {
                this.worker = new Worker('stockfish-worker.js');
            } catch (e) {
                console.warn('[StockfishBridge] Worker file failed, trying inline...');
                this._createInlineWorker();
            }

            if (!this.worker) {
                reject(new Error('Cannot create Stockfish worker'));
                return;
            }

            this.worker.onmessage = (e) => this._onMessage(e.data);
            this.worker.onerror = (e) => {
                console.error('[StockfishBridge] Worker error:', e);
                reject(e);
            };

            setTimeout(() => {
                if (!this.ready) {
                    console.warn('[StockfishBridge] Timeout loading Stockfish');
                    reject(new Error('Stockfish load timeout'));
                }
            }, 15000);

            this.worker.postMessage({ type: 'init' });
        });

        return this.readyPromise;
    }

    _createInlineWorker() {
        var lines = [];
        lines.push("var sf = null;");
        lines.push("function send(cmd) { if (sf && sf.postMessage) sf.postMessage(cmd); }");
        lines.push("function onMsg(line) {");
        lines.push("  if (typeof line !== 'string') return;");
        lines.push("  if (line === 'uciok') { send('setoption name Threads value 1'); send('setoption name Hash value 32'); send('isready'); }");
        lines.push("  if (line === 'readyok') postMessage({ type: 'ready' });");
        lines.push("  if (line.startsWith('bestmove ')) postMessage({ type: 'bestmove', move: line.split(' ')[1], info: {} });");
        lines.push("}");
        lines.push("self.onmessage = function(e) {");
        lines.push("  var msg = e.data;");
        lines.push("  if (msg.type === 'init') {");
        lines.push("    importScripts('https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js');");
        lines.push("    sf = typeof STOCKFISH === 'function' ? STOCKFISH() : null;");
        lines.push("    if (sf) { if (sf.addMessageListener) sf.addMessageListener(onMsg); else sf.print = onMsg; }");
        lines.push("    send('uci');");
        lines.push("  } else if (msg.type === 'search') {");
        lines.push("    if (msg.options.skillLevel !== undefined) send('setoption name Skill Level value ' + msg.options.skillLevel);");
        lines.push("    send('position fen ' + msg.fen);");
        lines.push("    var go = 'go';");
        lines.push("    if (msg.options.depth) go += ' depth ' + msg.options.depth;");
        lines.push("    if (msg.options.movetime) go += ' movetime ' + msg.options.movetime;");
        lines.push("    send(go);");
        lines.push("  } else if (msg.type === 'stop') { send('stop'); }");
        lines.push("  else if (msg.type === 'quit') { if (sf && sf.terminate) sf.terminate(); }");
        lines.push("};");
        var code = lines.join("\n");
        var blob = new Blob([code], { type: 'application/javascript' });
        this.worker = new Worker(URL.createObjectURL(blob));
    }

    _onMessage(msg) {
        if (msg.type === 'ready') {
            this.ready = true;
            console.log('[StockfishBridge] Stockfish WASM ready');
            if (this._readyResolve) {
                this._readyResolve();
                this._readyResolve = null;
            }
        }
        if (msg.type === 'bestmove') {
            if (this._searchResolve) {
                this._searchResolve(msg);
                this._searchResolve = null;
            }
        }
        if (msg.type === 'error') {
            console.error('[StockfishBridge]', msg.message);
        }
    }

    async search(fen, options) {
        if (!this.ready) await this.init();
        return new Promise((resolve) => {
            this._searchResolve = resolve;
            this.worker.postMessage({ type: 'search', fen: fen, options: options || {} });
        });
    }

    stop() {
        if (this.worker) this.worker.postMessage({ type: 'stop' });
    }

    destroy() {
        if (this.worker) {
            this.worker.postMessage({ type: 'quit' });
            this.worker.terminate();
            this.worker = null;
        }
        this.ready = false;
        this.readyPromise = null;
    }
}

// Singleton global
var stockfishBridge = new StockfishBridge();

// ==========================================================================
// ChessAI — Unified interface (local minimax + Stockfish)
// ==========================================================================
class ChessAI {
    constructor(difficulty) {
        this.difficulty = difficulty || AI_DIFFICULTY.MEDIUM;
        this.nodesSearched = 0;
        this.timeStart = 0;
        this.timeBudget = 0;
        this.aborted = false;
        this.stockfishLoading = false;
        this.stockfishFailed = false;

        if (this.difficulty >= AI_DIFFICULTY.HARD) {
            this._preloadStockfish();
        }
    }

    setDifficulty(level) {
        this.difficulty = level;
        if (level >= AI_DIFFICULTY.HARD) {
            this._preloadStockfish();
        }
    }

    async _preloadStockfish() {
        if (stockfishBridge.ready || this.stockfishLoading) return;
        this.stockfishLoading = true;
        try {
            await stockfishBridge.init();
            this.stockfishFailed = false;
            console.log('[ChessAI] Stockfish loaded successfully');
        } catch (e) {
            console.warn('[ChessAI] Stockfish unavailable, fallback to minimax:', e.message);
            this.stockfishFailed = true;
        }
        this.stockfishLoading = false;
    }

    _usesStockfish() {
        return this.difficulty >= AI_DIFFICULTY.HARD && !this.stockfishFailed;
    }

    _getStockfishOptions() {
        switch (this.difficulty) {
            case AI_DIFFICULTY.HARD:
                // ~1600 ELO — Skill Level 5, limited depth and time
                return { skillLevel: 5, depth: 10, movetime: 1000 };
            case AI_DIFFICULTY.EXPERT:
                // ~2200 ELO — Skill Level 14, deeper search
                return { skillLevel: 14, depth: 15, movetime: 3000 };
            case AI_DIFFICULTY.GRANDMASTER:
                // Full strength Stockfish — Skill Level 20, max depth
                return { skillLevel: 20, depth: 22, movetime: 10000 };
            default:
                return { skillLevel: 10, depth: 12, movetime: 2000 };
        }
    }

    _uciToMove(uciMove) {
        if (!uciMove || uciMove.length < 4) return null;
        var files = 'abcdefgh';
        var fromCol = files.indexOf(uciMove[0]);
        var fromRow = 8 - parseInt(uciMove[1]);
        var toCol = files.indexOf(uciMove[2]);
        var toRow = 8 - parseInt(uciMove[3]);
        var promotion = uciMove.length > 4 ? uciMove[4].toUpperCase() : undefined;
        return {
            from: { row: fromRow, col: fromCol },
            to: { row: toRow, col: toCol },
            promotion: promotion
        };
    }

    async findBestMove(engine, aiColor) {
        var allMoves = engine.getAllLegalMoves();
        if (allMoves.length === 0) return null;
        if (allMoves.length === 1) {
            var m = allMoves[0];
            return { from: m.from, to: m.to, promotion: m.promotion ? 'Q' : undefined };
        }

        if (this._usesStockfish()) {
            return this._findWithStockfish(engine, allMoves);
        }

        return this._findWithMinimax(engine, aiColor, allMoves);
    }

    async _findWithStockfish(engine, allMoves) {
        try {
            var fen = engine.toFEN();
            var options = this._getStockfishOptions();
            console.log('[ChessAI] Stockfish search: skill=' + options.skillLevel +
                ', depth=' + options.depth +
                ', movetime=' + options.movetime);

            var result = await stockfishBridge.search(fen, options);

            if (result && result.move) {
                var parsed = this._uciToMove(result.move);
                if (parsed) {
                    var legal = allMoves.find(function(m) {
                        return m.from.row === parsed.from.row &&
                               m.from.col === parsed.from.col &&
                               m.to.row === parsed.to.row &&
                               m.to.col === parsed.to.col;
                    });
                    if (legal) {
                        console.log('[ChessAI] Stockfish bestmove: ' + result.move);
                        return parsed;
                    }
                }
            }
        } catch (e) {
            console.warn('[ChessAI] Stockfish search failed:', e);
        }

        var m = allMoves[Math.floor(Math.random() * allMoves.length)];
        return { from: m.from, to: m.to, promotion: m.promotion ? 'Q' : undefined };
    }

    // ======================================================================
    // MINIMAX LOCAL (levels 1-2 or fallback)
    // ======================================================================

    _findWithMinimax(engine, aiColor, allMoves) {
        this.nodesSearched = 0;
        this.timeStart = Date.now();
        this.timeBudget = this.difficulty === 1 ? 500 : 1000;
        this.aborted = false;

        var depth = this.difficulty === 1 ? 1 : 2;
        var bestScore = -Infinity;
        var bestMoves = [];
        var alpha = -Infinity;
        var beta = Infinity;

        for (var i = 0; i < allMoves.length; i++) {
            var move = allMoves[i];
            var promo = move.promotion ? 'Q' : undefined;
            var copy = this._clone(engine);
            if (!copy.makeMove(move.from, move.to, promo)) continue;

            var score;
            if (depth <= 1) {
                score = this._evaluateSimple(copy.board, aiColor);
            } else {
                score = this._minimax(copy, depth - 1, alpha, beta, false, aiColor);
            }
            if (this.aborted) break;

            if (score > bestScore) {
                bestScore = score;
                bestMoves = [{ from: move.from, to: move.to, promotion: promo }];
            } else if (score === bestScore) {
                bestMoves.push({ from: move.from, to: move.to, promotion: promo });
            }
            alpha = Math.max(alpha, score);
        }

        if (bestMoves.length === 0) {
            var m = allMoves[0];
            return { from: m.from, to: m.to, promotion: m.promotion ? 'Q' : undefined };
        }
        return bestMoves[Math.floor(Math.random() * bestMoves.length)];
    }

    _minimax(engine, depth, alpha, beta, maximizing, aiColor) {
        this.nodesSearched++;
        if ((this.nodesSearched & 1023) === 0 && Date.now() - this.timeStart > this.timeBudget) {
            this.aborted = true;
            return this._evaluateSimple(engine.board, aiColor);
        }

        var allMoves = engine.getAllLegalMoves();
        if (allMoves.length === 0) {
            if (engine.isInCheck(engine.turn)) {
                return maximizing ? -100000 + depth : 100000 - depth;
            }
            return 0;
        }
        if (depth === 0) return this._evaluateSimple(engine.board, aiColor);

        allMoves.sort(function(a, b) {
            var sa = 0, sb = 0;
            var ta = engine.board[a.to.row][a.to.col];
            var tb = engine.board[b.to.row][b.to.col];
            if (ta) sa = PIECE_VALUES[ta.type] || 0;
            if (tb) sb = PIECE_VALUES[tb.type] || 0;
            if (a.promotion) sa += 900;
            if (b.promotion) sb += 900;
            return sb - sa;
        });

        var best, i, move, copy, val;
        if (maximizing) {
            best = -Infinity;
            for (i = 0; i < allMoves.length; i++) {
                move = allMoves[i];
                copy = this._clone(engine);
                copy.makeMove(move.from, move.to, move.promotion || undefined);
                val = this._minimax(copy, depth - 1, alpha, beta, false, aiColor);
                if (this.aborted) return val;
                best = Math.max(best, val);
                alpha = Math.max(alpha, val);
                if (beta <= alpha) break;
            }
            return best;
        } else {
            best = Infinity;
            for (i = 0; i < allMoves.length; i++) {
                move = allMoves[i];
                copy = this._clone(engine);
                copy.makeMove(move.from, move.to, move.promotion || undefined);
                val = this._minimax(copy, depth - 1, alpha, beta, true, aiColor);
                if (this.aborted) return val;
                best = Math.min(best, val);
                beta = Math.min(beta, val);
                if (beta <= alpha) break;
            }
            return best;
        }
    }

    _clone(engine) {
        var c = Object.create(ChessEngine.prototype);
        c.board = engine.board.map(function(row) {
            return row.map(function(cell) {
                return cell ? { type: cell.type, color: cell.color } : null;
            });
        });
        c.turn = engine.turn;
        c.castlingRights = {
            white: { kingSide: engine.castlingRights.white.kingSide, queenSide: engine.castlingRights.white.queenSide },
            black: { kingSide: engine.castlingRights.black.kingSide, queenSide: engine.castlingRights.black.queenSide }
        };
        c.enPassantTarget = engine.enPassantTarget ? { row: engine.enPassantTarget.row, col: engine.enPassantTarget.col } : null;
        c.halfMoveClock = engine.halfMoveClock;
        c.fullMoveNumber = engine.fullMoveNumber;
        c.moveHistory = [];
        c.lastMove = engine.lastMove ? { from: engine.lastMove.from, to: engine.lastMove.to } : null;
        c.gameOver = false;
        c.result = null;
        c.winner = null;
        return c;
    }

    _posBonus(row, col, type, color) {
        var table = PST[type];
        if (!table) return 0;
        return table[color === 'white' ? row : 7 - row][col];
    }

    _evaluateSimple(board, aiColor) {
        var s = 0;
        for (var r = 0; r < 8; r++) {
            for (var c = 0; c < 8; c++) {
                var p = board[r][c];
                if (!p) continue;
                var v = (PIECE_VALUES[p.type] || 0) + this._posBonus(r, c, p.type, p.color);
                s += p.color === aiColor ? v : -v;
            }
        }
        return s;
    }
}
