/**
 * ai.js - IA d'échecs avec Minimax + Alpha-Beta Pruning
 * Port du moteur C++ (AIPlayer) vers JavaScript.
 * Utilise le ChessEngine de chess.js pour la génération de coups et le plateau.
 *
 * Niveaux :
 *   EASY        (1) — profondeur 1, évaluation basique
 *   MEDIUM      (2) — profondeur 2, évaluation basique
 *   HARD        (3) — profondeur 3 + quiescence 3, évaluation avancée, time-budgeted
 *   EXPERT      (4) — profondeur 4 + quiescence 4, iterative deepening, null-move, TT
 *   GRANDMASTER (5) — profondeur 6 + quiescence 8, toutes optimisations, niveau GM
 *
 * Optimisations :
 *   - Time budget : la recherche s'arrête si le temps imparti est dépassé
 *   - Node budget : hard cap sur le nombre de noeuds pour éviter les freezes
 *   - Clone léger : pas de new ChessEngine(), copie directe des champs
 *   - TT eviction LRU-approx sans allocation
 *   - Delta pruning en quiescence
 *   - Aspiration windows (GRANDMASTER)
 *   - Futility pruning (GRANDMASTER)
 */

const AI_DIFFICULTY = {
    EASY: 1,
    MEDIUM: 2,
    HARD: 3,
    EXPERT: 4,
    GRANDMASTER: 5
};

// ---- PST (du point de vue des blancs, row 0 = rang 8) ----

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

const KING_EG_TABLE = [
    [-50,-40,-30,-20,-20,-30,-40,-50 ],
    [-30,-20,-10,  0,  0,-10,-20,-30 ],
    [-30,-10, 20, 30, 30, 20,-10,-30 ],
    [-30,-10, 30, 40, 40, 30,-10,-30 ],
    [-30,-10, 30, 40, 40, 30,-10,-30 ],
    [-30,-10, 20, 30, 30, 20,-10,-30 ],
    [-30,-30,  0,  0,  0,  0,-30,-30 ],
    [-50,-30,-30,-30,-30,-30,-30,-50 ]
];

const PST = { P: PAWN_TABLE, N: KNIGHT_TABLE, B: BISHOP_TABLE, R: ROOK_TABLE, Q: QUEEN_TABLE, K: KING_MG_TABLE };

const PIECE_VALUES = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };

// ==============================================================
// Transposition Table
// ==============================================================
const TT_EXACT = 0;
const TT_ALPHA = 1;
const TT_BETA  = 2;

class TranspositionTable {
    constructor(maxSize = 1 << 16) { // 65k entries default, 256k for GM
        this.maxSize = maxSize;
        this.table = new Map();
        this.gen = 0; // generation counter for aging
    }

    resize(newSize) {
        this.maxSize = newSize;
        if (this.table.size > newSize) {
            this.clear();
        }
    }

    _hash(engine) {
        // Fast board hash using string key
        let h = '';
        const b = engine.board;
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = b[r][c];
                h += p ? (p.color === 'white' ? 'w' : 'b') + p.type : '.';
            }
        }
        h += engine.turn === 'white' ? 'w' : 'b';
        const cr = engine.castlingRights;
        h += (cr.white.kingSide  ? '1' : '0');
        h += (cr.white.queenSide ? '1' : '0');
        h += (cr.black.kingSide  ? '1' : '0');
        h += (cr.black.queenSide ? '1' : '0');
        const ep = engine.enPassantTarget;
        if (ep) h += ep.row * 8 + ep.col;
        return h;
    }

    get(engine, depth) {
        const entry = this.table.get(this._hash(engine));
        if (entry && entry.depth >= depth) return entry;
        return null;
    }

    set(engine, depth, score, flag, bestMove) {
        const key = this._hash(engine);
        const existing = this.table.get(key);
        // Replace if new search is deeper, or same generation deeper-or-equal
        if (existing && existing.depth > depth && existing.gen === this.gen) return;

        if (this.table.size >= this.maxSize && !existing) {
            // Evict one old entry instead of mass-evicting 25%
            // Just let Map overwrite — won't grow beyond maxSize+1
            // Periodically trim in bulk only if we really exceed
            if (this.table.size >= this.maxSize * 1.1) {
                // Delete ~10% oldest entries by iterator order (FIFO-ish)
                let toDel = this.maxSize * 0.1 | 0;
                for (const k of this.table.keys()) {
                    this.table.delete(k);
                    if (--toDel <= 0) break;
                }
            }
        }
        this.table.set(key, { depth, score, flag, bestMove, gen: this.gen });
    }

    newSearch() { this.gen++; }
    clear() { this.table.clear(); this.gen = 0; }
}


// ==============================================================
// ChessAI
// ==============================================================
class ChessAI {
    constructor(difficulty = AI_DIFFICULTY.MEDIUM) {
        this.difficulty = difficulty;
        this.nodesSearched = 0;
        this.timeStart = 0;
        this.timeBudget = 0;
        this.aborted = false;
        this.tt = new TranspositionTable();
        this.historyTable = {};
        this.killerMoves = [];
    }

    setDifficulty(level) { this.difficulty = level; }

    // ---- Time / node management ----

    /** Time budget (ms) allowed for the full search */
    _getTimeBudget() {
        switch (this.difficulty) {
            case 1: return 500;
            case 2: return 1000;
            case 3: return 2000;
            case 4: return 3500;
            case 5: return 15000;  // GRANDMASTER: 15 secondes
            default: return 1000;
        }
    }

    /** Max nodes before forced abort */
    _getNodeBudget() {
        switch (this.difficulty) {
            case 1: return 5000;
            case 2: return 50000;
            case 3: return 300000;
            case 4: return 800000;
            case 5: return 5000000;  // GRANDMASTER: 5 millions
            default: return 50000;
        }
    }

    /** Check every N nodes if time exceeded */
    _checkAbort() {
        if (this.aborted) return true;
        // Check every 1024 nodes to avoid Date.now() overhead
        if ((this.nodesSearched & 1023) === 0) {
            if (Date.now() - this.timeStart > this.timeBudget) {
                this.aborted = true;
                return true;
            }
        }
        if (this.nodesSearched > this._getNodeBudget()) {
            this.aborted = true;
            return true;
        }
        return false;
    }

    // ---- Depths ----

    _getMaxDepth() {
        switch (this.difficulty) {
            case 1: return 1;
            case 2: return 2;
            case 3: return 3;
            case 4: return 4;
            case 5: return 6;  // GRANDMASTER: profondeur 6
            default: return 2;
        }
    }

    _getQDepth() {
        switch (this.difficulty) {
            case 3: return 3;
            case 4: return 4;
            case 5: return 8;  // GRANDMASTER: quiescence 8
            default: return 0;
        }
    }

    // ---- Material helpers ----

    _totalMaterial(board) {
        let t = 0;
        for (let r = 0; r < 8; r++)
            for (let c = 0; c < 8; c++) {
                const p = board[r][c];
                if (p && p.type !== 'K') t += PIECE_VALUES[p.type] || 0;
            }
        return t;
    }

    // ---- Lightweight clone ----

    _clone(engine) {
        // Avoid calling new ChessEngine() — create a plain object with same shape
        const c = Object.create(ChessEngine.prototype);
        c.board = engine.board.map(row => row.map(cell => cell ? { type: cell.type, color: cell.color } : null));
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

    // ---- Position bonus ----

    _posBonus(row, col, type, color, isEndgame) {
        const table = (type === 'K' && isEndgame) ? KING_EG_TABLE : PST[type];
        if (!table) return 0;
        return table[color === 'white' ? row : 7 - row][col];
    }

    // ---- Evaluation ----

    _evaluateSimple(board, aiColor) {
        let s = 0;
        for (let r = 0; r < 8; r++)
            for (let c = 0; c < 8; c++) {
                const p = board[r][c];
                if (!p) continue;
                const v = (PIECE_VALUES[p.type] || 0) + this._posBonus(r, c, p.type, p.color, false);
                s += p.color === aiColor ? v : -v;
            }
        return s;
    }

    _evaluateAdvanced(board, aiColor) {
        const opp = aiColor === 'white' ? 'black' : 'white';
        let score = 0;
        const mat = this._totalMaterial(board);
        const eg = mat < 2600;
        let aiBishops = 0, oppBishops = 0;
        const aiPawns = [], oppPawns = [];

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = board[r][c];
                if (!p) continue;
                const sign = p.color === aiColor ? 1 : -1;
                score += sign * ((PIECE_VALUES[p.type] || 0) + this._posBonus(r, c, p.type, p.color, eg));

                if (p.type === 'B') { if (p.color === aiColor) aiBishops++; else oppBishops++; }
                if (p.type === 'P') { (p.color === aiColor ? aiPawns : oppPawns).push({ r, c }); }

                // Rook on open file (lightweight check)
                if (p.type === 'R') {
                    let friendlyPawn = false, enemyPawn = false;
                    for (let rr = 0; rr < 8; rr++) {
                        const pp = board[rr][c];
                        if (pp && pp.type === 'P') {
                            if (pp.color === p.color) friendlyPawn = true;
                            else enemyPawn = true;
                        }
                    }
                    if (!friendlyPawn && !enemyPawn) score += sign * 20;
                    else if (!friendlyPawn) score += sign * 10;
                }
            }
        }

        // Bishop pair
        if (aiBishops >= 2) score += 45;
        if (oppBishops >= 2) score -= 45;

        // Passed pawns (simplified — no full structure scan)
        score += this._passedPawnBonus(aiPawns, oppPawns, aiColor);
        score -= this._passedPawnBonus(oppPawns, aiPawns, opp);

        // King safety (middlegame)
        if (!eg) {
            score += this._kingSafety(board, aiColor);
            score -= this._kingSafety(board, opp);
        }

        return score;
    }

    _passedPawnBonus(friendlyPawns, enemyPawns, color) {
        let bonus = 0;
        const promoRow = color === 'white' ? 0 : 7;
        for (const p of friendlyPawns) {
            let passed = true;
            for (const e of enemyPawns) {
                if (Math.abs(e.c - p.c) <= 1) {
                    if (color === 'white' ? e.r < p.r : e.r > p.r) { passed = false; break; }
                }
            }
            if (passed) bonus += 15 + (7 - Math.abs(p.r - promoRow)) * 10;
        }
        return bonus;
    }

    _kingSafety(board, color) {
        let kr = -1, kc = -1;
        for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
            const p = board[r][c];
            if (p && p.type === 'K' && p.color === color) { kr = r; kc = c; break; }
            if (kr >= 0) break;
        }
        if (kr < 0) return 0;
        let s = 0;
        const dir = color === 'white' ? -1 : 1;
        for (let dc = -1; dc <= 1; dc++) {
            const sc = kc + dc, sr = kr + dir;
            if (sc < 0 || sc > 7 || sr < 0 || sr > 7) continue;
            const p = board[sr][sc];
            if (p && p.type === 'P' && p.color === color) s += 10;
            else s -= 6;
        }
        return s;
    }

    _evaluate(board, aiColor) {
        return this.difficulty >= AI_DIFFICULTY.HARD
            ? this._evaluateAdvanced(board, aiColor)
            : this._evaluateSimple(board, aiColor);
    }

    // ---- Move key ----
    _moveKey(m) { return (m.from.row << 9) | (m.from.col << 6) | (m.to.row << 3) | m.to.col; }

    // ---- Move ordering ----

    _sortMoves(moves, engine, ply, ttBestMove) {
        const b = engine.board;
        const scored = new Array(moves.length);
        for (let i = 0; i < moves.length; i++) {
            const m = moves[i];
            let s = 0;

            // TT best move
            if (ttBestMove &&
                m.from.row === ttBestMove.from.row && m.from.col === ttBestMove.from.col &&
                m.to.row === ttBestMove.to.row && m.to.col === ttBestMove.to.col) {
                s = 1000000;
            }

            // MVV-LVA
            const target = b[m.to.row][m.to.col];
            if (target) {
                const vv = PIECE_VALUES[target.type] || 0;
                const av = PIECE_VALUES[b[m.from.row][m.from.col]?.type] || 0;
                s += 10000 + vv * 10 - av;
            }
            if (m.isEnPassant) s += 10000 + 1000;
            if (m.promotion) s += 9000;

            // Killers
            const killers = this.killerMoves[ply];
            if (killers) {
                for (let k = 0; k < killers.length; k++) {
                    const killer = killers[k];
                    if (killer &&
                        m.from.row === killer.from.row && m.from.col === killer.from.col &&
                        m.to.row === killer.to.row && m.to.col === killer.to.col) {
                        s += 5000; break;
                    }
                }
            }

            // History
            const key = this._moveKey(m);
            if (this.historyTable[key]) s += Math.min(this.historyTable[key], 4000);

            scored[i] = { m, s };
        }
        scored.sort((a, b) => b.s - a.s);
        return scored.map(x => x.m);
    }

    // ---- Quiescence search ----

    _quiescence(engine, alpha, beta, aiColor, qDepth) {
        this.nodesSearched++;
        if (this._checkAbort()) return this._evaluate(engine.board, aiColor);

        const standPat = this._evaluate(engine.board, aiColor);
        if (qDepth <= 0) return standPat;
        if (standPat >= beta) return beta;
        if (standPat > alpha) alpha = standPat;

        // Delta pruning: if even capturing a queen can't raise alpha, skip
        if (standPat + 1000 < alpha) return alpha;

        // Generate all legal moves, filter captures + promotions
        const allMoves = engine.getAllLegalMoves();

        // Inline filter + MVV sort (combined to avoid extra iterations)
        const captures = [];
        for (let i = 0; i < allMoves.length; i++) {
            const m = allMoves[i];
            const target = engine.board[m.to.row][m.to.col];
            if (target || m.isEnPassant || m.promotion) {
                let sv = 0;
                if (target) sv = PIECE_VALUES[target.type] || 0;
                if (m.isEnPassant) sv = 100;
                if (m.promotion) sv += 900;
                captures.push({ m, sv });
            }
        }
        captures.sort((a, b) => b.sv - a.sv);

        for (let i = 0; i < captures.length; i++) {
            const move = captures[i].m;
            const copy = this._clone(engine);
            if (!copy.makeMove(move.from, move.to, move.promotion || undefined)) continue;

            const score = this._quiescence(copy, alpha, beta, aiColor, qDepth - 1);
            if (this.aborted) return score;
            if (score >= beta) return beta;
            if (score > alpha) alpha = score;
        }
        return alpha;
    }

    // ---- Minimax basic (Easy/Medium) ----

    _minimaxBasic(engine, depth, alpha, beta, maximizing, aiColor) {
        this.nodesSearched++;
        if (this._checkAbort()) return this._evaluate(engine.board, aiColor);

        const allMoves = engine.getAllLegalMoves();

        if (allMoves.length === 0) {
            if (engine.isInCheck(engine.turn)) {
                return maximizing ? -100000 + (this._getMaxDepth() - depth) : 100000 - (this._getMaxDepth() - depth);
            }
            return 0;
        }

        if (depth === 0) return this._evaluateSimple(engine.board, aiColor);

        // Simple capture-first ordering
        allMoves.sort((a, b) => {
            let sa = 0, sb = 0;
            const ta = engine.board[a.to.row][a.to.col];
            const tb = engine.board[b.to.row][b.to.col];
            if (ta) sa = 10 * (PIECE_VALUES[ta.type] || 0);
            if (a.isEnPassant) sa += 1000;
            if (a.promotion) sa += 900;
            if (tb) sb = 10 * (PIECE_VALUES[tb.type] || 0);
            if (b.isEnPassant) sb += 1000;
            if (b.promotion) sb += 900;
            return sb - sa;
        });

        if (maximizing) {
            let best = -Infinity;
            for (const move of allMoves) {
                const copy = this._clone(engine);
                copy.makeMove(move.from, move.to, move.promotion || undefined);
                const val = this._minimaxBasic(copy, depth - 1, alpha, beta, false, aiColor);
                if (this.aborted) return val;
                best = Math.max(best, val);
                alpha = Math.max(alpha, val);
                if (beta <= alpha) break;
            }
            return best;
        } else {
            let best = Infinity;
            for (const move of allMoves) {
                const copy = this._clone(engine);
                copy.makeMove(move.from, move.to, move.promotion || undefined);
                const val = this._minimaxBasic(copy, depth - 1, alpha, beta, true, aiColor);
                if (this.aborted) return val;
                best = Math.min(best, val);
                beta = Math.min(beta, val);
                if (beta <= alpha) break;
            }
            return best;
        }
    }

    // ---- Alpha-Beta advanced (Hard/Expert/GrandMaster) ----

    _alphaBeta(engine, depth, alpha, beta, maximizing, aiColor, ply, allowNull) {
        this.nodesSearched++;
        if (this._checkAbort()) return this._evaluate(engine.board, aiColor);

        const allMoves = engine.getAllLegalMoves();
        const inCheck = engine.isInCheck(engine.turn);

        // Terminal
        if (allMoves.length === 0) {
            if (inCheck) return maximizing ? (-100000 + ply) : (100000 - ply);
            return 0;
        }

        // Leaf → quiescence
        if (depth <= 0) return this._quiescence(engine, alpha, beta, aiColor, this._getQDepth());

        // TT probe
        let ttBestMove = null;
        if (this.difficulty >= AI_DIFFICULTY.EXPERT) {
            const ttEntry = this.tt.get(engine, depth);
            if (ttEntry) {
                if (ttEntry.flag === TT_EXACT) return ttEntry.score;
                if (ttEntry.flag === TT_BETA && ttEntry.score >= beta) return ttEntry.score;
                if (ttEntry.flag === TT_ALPHA && ttEntry.score <= alpha) return ttEntry.score;
                ttBestMove = ttEntry.bestMove;
            }
        }

        // Null-move pruning (Expert+, not in check, not endgame, maximizing side)
        if (this.difficulty >= AI_DIFFICULTY.EXPERT &&
            allowNull && depth >= 3 && maximizing && !inCheck &&
            this._totalMaterial(engine.board) > 2600) {
            const R = this.difficulty >= AI_DIFFICULTY.GRANDMASTER ? 4 : 3; // Stronger reduction for GM
            const nullCopy = this._clone(engine);
            nullCopy.turn = nullCopy.turn === 'white' ? 'black' : 'white';
            nullCopy.enPassantTarget = null;
            const nullScore = this._alphaBeta(nullCopy, depth - R, alpha, beta, false, aiColor, ply + 1, false);
            if (this.aborted) return nullScore;
            if (nullScore >= beta) return beta;
        }

        // Futility pruning (GRANDMASTER only) - skip quiet moves at low depths if position is hopeless
        const futilityMargin = [0, 200, 350, 500]; // margins for depth 1, 2, 3
        let staticEval = null;
        const canFutility = this.difficulty >= AI_DIFFICULTY.GRANDMASTER && 
                           depth <= 3 && !inCheck && Math.abs(alpha) < 90000;
        if (canFutility) {
            staticEval = this._evaluate(engine.board, aiColor);
        }

        // Sort moves
        const sorted = this._sortMoves(allMoves, engine, ply, ttBestMove);

        let bestScore = maximizing ? -Infinity : Infinity;
        let bestMove = null;
        const origAlpha = alpha;

        for (let i = 0; i < sorted.length; i++) {
            const move = sorted[i];
            const isCapture = engine.board[move.to.row][move.to.col] || move.isEnPassant;
            const isPromo = !!move.promotion;

            // Futility pruning: skip quiet moves that can't possibly raise alpha
            if (canFutility && i > 0 && !isCapture && !isPromo) {
                const margin = futilityMargin[depth] || 500;
                if (maximizing && staticEval + margin < alpha) continue;
                if (!maximizing && staticEval - margin > beta) continue;
            }

            const copy = this._clone(engine);
            const promo = move.promotion ? 'Q' : undefined;
            if (!copy.makeMove(move.from, move.to, promo)) continue;

            const givesCheck = copy.isInCheck(copy.turn);
            let score;

            // Late Move Reduction (Expert+, quiet late moves, no check)
            if (this.difficulty >= AI_DIFFICULTY.EXPERT &&
                i >= 4 && depth >= 3 && !isCapture && !isPromo && !givesCheck && !inCheck) {
                // GM uses more aggressive LMR
                const R = this.difficulty >= AI_DIFFICULTY.GRANDMASTER ? 
                          Math.min(2, 1 + Math.floor(i / 8)) : 1;
                score = this._alphaBeta(copy, depth - 1 - R, alpha, beta, !maximizing, aiColor, ply + 1, true);
                if (this.aborted) return score;
                // Re-search if promising
                if (maximizing ? score > alpha : score < beta) {
                    score = this._alphaBeta(copy, depth - 1, alpha, beta, !maximizing, aiColor, ply + 1, true);
                }
            } else {
                score = this._alphaBeta(copy, depth - 1, alpha, beta, !maximizing, aiColor, ply + 1, true);
            }
            if (this.aborted) return score;

            if (maximizing) {
                if (score > bestScore) { bestScore = score; bestMove = move; }
                alpha = Math.max(alpha, score);
            } else {
                if (score < bestScore) { bestScore = score; bestMove = move; }
                beta = Math.min(beta, score);
            }

            if (beta <= alpha) {
                // Killer + history
                if (!isCapture) {
                    if (!this.killerMoves[ply]) this.killerMoves[ply] = [null, null];
                    this.killerMoves[ply][1] = this.killerMoves[ply][0];
                    this.killerMoves[ply][0] = move;
                    const key = this._moveKey(move);
                    this.historyTable[key] = (this.historyTable[key] || 0) + depth * depth;
                }
                break;
            }
        }

        // TT store
        if (this.difficulty >= AI_DIFFICULTY.EXPERT && bestMove) {
            let flag = TT_EXACT;
            if (bestScore <= origAlpha) flag = TT_ALPHA;
            else if (bestScore >= beta) flag = TT_BETA;
            this.tt.set(engine, depth, bestScore, flag, bestMove);
        }

        return bestScore;
    }

    // ---- Public API ----

    /**
     * Trouve le meilleur coup. Garanti de terminer dans le budget temps.
     */
    findBestMove(engine, aiColor) {
        const allMoves = engine.getAllLegalMoves();
        if (allMoves.length === 0) return null;
        if (allMoves.length === 1) {
            // Only one legal move — return immediately
            const m = allMoves[0];
            return { from: m.from, to: m.to, promotion: m.promotion ? 'Q' : undefined };
        }

        this.nodesSearched = 0;
        this.timeStart = Date.now();
        this.timeBudget = this._getTimeBudget();
        this.aborted = false;

        if (this.difficulty <= AI_DIFFICULTY.MEDIUM) {
            return this._findBestBasic(engine, aiColor, allMoves);
        }
        return this._findBestAdvanced(engine, aiColor, allMoves);
    }

    _findBestBasic(engine, aiColor, allMoves) {
        const depth = this._getMaxDepth();
        let bestScore = -Infinity;
        let bestMoves = [];
        let alpha = -Infinity;
        const beta = Infinity;

        for (const move of allMoves) {
            const promo = move.promotion ? 'Q' : undefined;
            const copy = this._clone(engine);
            if (!copy.makeMove(move.from, move.to, promo)) continue;

            let score;
            if (depth <= 1) {
                score = this._evaluateSimple(copy.board, aiColor);
            } else {
                score = this._minimaxBasic(copy, depth - 1, alpha, beta, false, aiColor);
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
            const m = allMoves[0];
            return { from: m.from, to: m.to, promotion: m.promotion ? 'Q' : undefined };
        }
        return bestMoves[Math.floor(Math.random() * bestMoves.length)];
    }

    _findBestAdvanced(engine, aiColor, allMoves) {
        const maxDepth = this._getMaxDepth();
        const useAspiration = this.difficulty >= AI_DIFFICULTY.GRANDMASTER;

        // Reset heuristics
        this.historyTable = {};
        this.killerMoves = [];
        this.tt.newSearch();
        
        // Resize TT for GRANDMASTER (256k entries)
        if (this.difficulty >= AI_DIFFICULTY.GRANDMASTER) {
            this.tt.resize(1 << 18); // 256k
        }

        let bestMove = null;
        let bestScore = -Infinity;

        // Iterative deepening with time control
        for (let depth = 1; depth <= maxDepth; depth++) {
            let currentBest = null;
            let currentBestScore = -Infinity;
            
            // Aspiration windows for GRANDMASTER at depth >= 4
            let alpha = -Infinity;
            let beta = Infinity;
            let aspirationDelta = 50;
            
            if (useAspiration && depth >= 4 && bestScore > -90000 && bestScore < 90000) {
                alpha = bestScore - aspirationDelta;
                beta = bestScore + aspirationDelta;
            }

            const sorted = this._sortMoves(allMoves, engine, 0,
                bestMove ? { from: bestMove.from, to: bestMove.to } : null
            );

            // Aspiration window loop
            let aspirationFailed = true;
            while (aspirationFailed) {
                aspirationFailed = false;
                currentBest = null;
                currentBestScore = -Infinity;
                let localAlpha = alpha;

                for (const move of sorted) {
                    const promo = move.promotion ? 'Q' : undefined;
                    const copy = this._clone(engine);
                    if (!copy.makeMove(move.from, move.to, promo)) continue;

                    const score = this._alphaBeta(copy, depth - 1, localAlpha, beta, false, aiColor, 1, true);

                    if (this.aborted) break;

                    if (score > currentBestScore) {
                        currentBestScore = score;
                        currentBest = { from: move.from, to: move.to, promotion: promo };
                    }
                    localAlpha = Math.max(localAlpha, score);
                }

                // Check if aspiration window failed
                if (useAspiration && depth >= 4 && !this.aborted) {
                    if (currentBestScore <= alpha) {
                        // Fail low - widen window
                        alpha = Math.max(-Infinity, alpha - aspirationDelta * 4);
                        aspirationDelta *= 4;
                        aspirationFailed = true;
                    } else if (currentBestScore >= beta) {
                        // Fail high - widen window
                        beta = Math.min(Infinity, beta + aspirationDelta * 4);
                        aspirationDelta *= 4;
                        aspirationFailed = true;
                    }
                }
                
                if (this.aborted) break;
            }

            // Only accept completed iterations
            if (!this.aborted && currentBest) {
                bestMove = currentBest;
                bestScore = currentBestScore;
            }

            // Early exit on mate found or time exceeded
            if (bestScore >= 90000 || this.aborted) break;
        }

        if (!bestMove) {
            const m = allMoves[0];
            return { from: m.from, to: m.to, promotion: m.promotion ? 'Q' : undefined };
        }
        return bestMove;
    }
}
