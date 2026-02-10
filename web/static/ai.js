/**
 * ai.js - IA d'échecs avec Minimax + Alpha-Beta Pruning
 * Port du moteur C++ (AIPlayer) vers JavaScript.
 * Utilise le ChessEngine de chess.js pour la génération de coups et le plateau.
 *
 * Niveaux :
 *   EASY   (1) — profondeur 1, évaluation basique
 *   MEDIUM (2) — profondeur 2, évaluation basique
 *   HARD   (3) — profondeur 4 + quiescence, évaluation avancée, mobilité, structure de pions
 *   EXPERT (4) — profondeur 5 + iterative deepening, null-move pruning, transposition table
 */

const AI_DIFFICULTY = {
    EASY: 1,
    MEDIUM: 2,
    HARD: 3,
    EXPERT: 4
};

// ---- Tables de bonus de position (du point de vue des blancs, row 0 = rang 8) ----

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

const KING_TABLE = [
    [-30,-40,-40,-50,-50,-40,-40,-30 ],
    [-30,-40,-40,-50,-50,-40,-40,-30 ],
    [-30,-40,-40,-50,-50,-40,-40,-30 ],
    [-30,-40,-40,-50,-50,-40,-40,-30 ],
    [-20,-30,-30,-40,-40,-30,-30,-20 ],
    [-10,-20,-20,-20,-20,-20,-20,-10 ],
    [ 20, 20,  0,  0,  0,  0, 20, 20 ],
    [ 20, 30, 10,  0,  0, 10, 30, 20 ]
];

// Endgame king table — roi plus actif au centre
const KING_ENDGAME_TABLE = [
    [-50,-40,-30,-20,-20,-30,-40,-50 ],
    [-30,-20,-10,  0,  0,-10,-20,-30 ],
    [-30,-10, 20, 30, 30, 20,-10,-30 ],
    [-30,-10, 30, 40, 40, 30,-10,-30 ],
    [-30,-10, 30, 40, 40, 30,-10,-30 ],
    [-30,-10, 20, 30, 30, 20,-10,-30 ],
    [-30,-30,  0,  0,  0,  0,-30,-30 ],
    [-50,-30,-30,-30,-30,-30,-30,-50 ]
];

const PST = {
    'P': PAWN_TABLE,
    'N': KNIGHT_TABLE,
    'B': BISHOP_TABLE,
    'R': ROOK_TABLE,
    'Q': QUEEN_TABLE,
    'K': KING_TABLE
};

const PIECE_VALUES = {
    'P': 100,
    'N': 320,
    'B': 330,
    'R': 500,
    'Q': 900,
    'K': 20000
};

// ==============================================================
// Transposition Table (for Expert level)
// ==============================================================
const TT_EXACT = 0;
const TT_ALPHA = 1;  // upper bound
const TT_BETA  = 2;  // lower bound

class TranspositionTable {
    constructor(maxSize = 1 << 18) { // ~262k entries
        this.maxSize = maxSize;
        this.table = new Map();
    }

    hash(engine) {
        // Fast board hash using string representation
        let h = '';
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = engine.board[r][c];
                h += p ? (p.color[0] + p.type) : '-';
            }
        }
        h += engine.turn[0];
        h += (engine.castlingRights.white.kingSide ? '1' : '0');
        h += (engine.castlingRights.white.queenSide ? '1' : '0');
        h += (engine.castlingRights.black.kingSide ? '1' : '0');
        h += (engine.castlingRights.black.queenSide ? '1' : '0');
        if (engine.enPassantTarget) {
            h += engine.enPassantTarget.row + '' + engine.enPassantTarget.col;
        }
        return h;
    }

    get(engine, depth) {
        const key = this.hash(engine);
        const entry = this.table.get(key);
        if (entry && entry.depth >= depth) {
            return entry;
        }
        return null;
    }

    set(engine, depth, score, flag, bestMove) {
        const key = this.hash(engine);
        // Always-replace scheme
        if (this.table.size >= this.maxSize) {
            // Delete oldest entries (first 25%)
            const keys = [...this.table.keys()];
            for (let i = 0; i < keys.length / 4; i++) {
                this.table.delete(keys[i]);
            }
        }
        this.table.set(key, { depth, score, flag, bestMove });
    }

    clear() {
        this.table.clear();
    }
}


class ChessAI {
    constructor(difficulty = AI_DIFFICULTY.MEDIUM) {
        this.difficulty = difficulty;
        this.nodesSearched = 0;
        this.tt = new TranspositionTable();
        this.historyTable = {};  // history heuristic for move ordering
        this.killerMoves = [];    // killer moves per ply
    }

    setDifficulty(level) {
        this.difficulty = level;
    }

    /**
     * Compte le matériel total (hors roi) pour déterminer la phase de jeu
     */
    getTotalMaterial(board) {
        let total = 0;
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = board[r][c];
                if (p && p.type !== 'K') {
                    total += PIECE_VALUES[p.type] || 0;
                }
            }
        }
        return total;
    }

    /**
     * Retourne le bonus positionnel d'une pièce.
     */
    getPositionBonus(row, col, type, color, isEndgame) {
        let table;
        if (type === 'K' && isEndgame) {
            table = KING_ENDGAME_TABLE;
        } else {
            table = PST[type];
        }
        if (!table) return 0;
        const r = (color === 'white') ? row : (7 - row);
        return table[r][col];
    }

    /**
     * Évaluation avancée du plateau (pour Hard/Expert).
     */
    evaluateBoardAdvanced(board, aiColor) {
        const opponentColor = aiColor === 'white' ? 'black' : 'white';
        let score = 0;
        const totalMaterial = this.getTotalMaterial(board);
        const isEndgame = totalMaterial < 2600; // Roughly when queens are off + some pieces

        let aiBishops = 0, oppBishops = 0;
        let aiPawnFiles = new Set(), oppPawnFiles = new Set();
        let aiPawns = [], oppPawns = [];

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = board[row][col];
                if (!piece) continue;

                const value = PIECE_VALUES[piece.type] || 0;
                const bonus = this.getPositionBonus(row, col, piece.type, piece.color, isEndgame);
                const sign = piece.color === aiColor ? 1 : -1;

                score += sign * (value + bonus);

                // Track bishops for bishop pair bonus
                if (piece.type === 'B') {
                    if (piece.color === aiColor) aiBishops++;
                    else oppBishops++;
                }

                // Track pawns for structure analysis
                if (piece.type === 'P') {
                    if (piece.color === aiColor) {
                        aiPawnFiles.add(col);
                        aiPawns.push({ row, col });
                    } else {
                        oppPawnFiles.add(col);
                        oppPawns.push({ row, col });
                    }
                }

                // Rook on open/semi-open file
                if (piece.type === 'R') {
                    const friendlyPawns = piece.color === aiColor ? aiPawnFiles : oppPawnFiles;
                    const enemyPawns = piece.color === aiColor ? oppPawnFiles : aiPawnFiles;
                    if (!friendlyPawns.has(col) && !enemyPawns.has(col)) {
                        score += sign * 25; // Open file
                    } else if (!friendlyPawns.has(col)) {
                        score += sign * 12; // Semi-open file
                    }
                }
            }
        }

        // Bishop pair bonus (~50cp)
        if (aiBishops >= 2) score += 50;
        if (oppBishops >= 2) score -= 50;

        // Pawn structure analysis
        score += this.evaluatePawnStructure(aiPawns, oppPawns, aiColor, board);

        // King safety (middlegame only)
        if (!isEndgame) {
            score += this.evaluateKingSafety(board, aiColor);
            score -= this.evaluateKingSafety(board, opponentColor);
        }

        return score;
    }

    /**
     * Évalue la structure de pions : pions passés, doublés, isolés
     */
    evaluatePawnStructure(aiPawns, oppPawns, aiColor, board) {
        let score = 0;
        const direction = aiColor === 'white' ? -1 : 1;
        const promotionRow = aiColor === 'white' ? 0 : 7;

        for (const pawn of aiPawns) {
            // Pion passé : aucun pion adverse devant sur la même colonne ou colonnes adjacentes
            let passed = true;
            for (const oppPawn of oppPawns) {
                if (Math.abs(oppPawn.col - pawn.col) <= 1) {
                    if (aiColor === 'white' && oppPawn.row < pawn.row) {
                        passed = false;
                        break;
                    }
                    if (aiColor === 'black' && oppPawn.row > pawn.row) {
                        passed = false;
                        break;
                    }
                }
            }
            if (passed) {
                const distToPromo = Math.abs(pawn.row - promotionRow);
                score += 20 + (7 - distToPromo) * 15; // Plus le pion est avancé, plus le bonus est gros
            }

            // Pion isolé : pas de pion ami sur les colonnes adjacentes
            const hasNeighbor = aiPawns.some(p =>
                p !== pawn && Math.abs(p.col - pawn.col) === 1
            );
            if (!hasNeighbor) {
                score -= 15;
            }

            // Pion doublé
            const doubled = aiPawns.filter(p => p.col === pawn.col).length;
            if (doubled > 1) {
                score -= 10;
            }
        }

        // Same for opponent (negate)
        for (const pawn of oppPawns) {
            let passed = true;
            for (const aiPawn of aiPawns) {
                if (Math.abs(aiPawn.col - pawn.col) <= 1) {
                    const oppColor = aiColor === 'white' ? 'black' : 'white';
                    if (oppColor === 'white' && aiPawn.row < pawn.row) {
                        passed = false; break;
                    }
                    if (oppColor === 'black' && aiPawn.row > pawn.row) {
                        passed = false; break;
                    }
                }
            }
            if (passed) {
                const promoRow = aiColor === 'white' ? 7 : 0;
                const distToPromo = Math.abs(pawn.row - promoRow);
                score -= 20 + (7 - distToPromo) * 15;
            }

            const hasNeighbor = oppPawns.some(p =>
                p !== pawn && Math.abs(p.col - pawn.col) === 1
            );
            if (!hasNeighbor) score += 15;

            const doubled = oppPawns.filter(p => p.col === pawn.col).length;
            if (doubled > 1) score += 10;
        }

        return score;
    }

    /**
     * Évalue la sécurité du roi (bouclier de pions)
     */
    evaluateKingSafety(board, color) {
        let score = 0;
        // Find king
        let kingRow = -1, kingCol = -1;
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = board[r][c];
                if (p && p.type === 'K' && p.color === color) {
                    kingRow = r; kingCol = c;
                    break;
                }
            }
            if (kingRow >= 0) break;
        }

        if (kingRow < 0) return 0;

        // Pawn shield (check 3 squares in front of king)
        const dir = color === 'white' ? -1 : 1;
        for (let dc = -1; dc <= 1; dc++) {
            const sc = kingCol + dc;
            if (sc < 0 || sc > 7) continue;
            const sr = kingRow + dir;
            if (sr < 0 || sr > 7) continue;

            const p = board[sr][sc];
            if (p && p.type === 'P' && p.color === color) {
                score += 12; // Pawn shield bonus
            } else {
                score -= 8; // Missing shield penalty
            }
        }

        // Penalty if king is on open file
        let pawnOnFile = false;
        for (let r = 0; r < 8; r++) {
            const p = board[r][kingCol];
            if (p && p.type === 'P' && p.color === color) {
                pawnOnFile = true; break;
            }
        }
        if (!pawnOnFile) score -= 20;

        return score;
    }

    /**
     * Évaluation basique (pour Easy/Medium).
     */
    evaluateBoard(board, aiColor) {
        let score = 0;
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = board[row][col];
                if (!piece) continue;

                const value = PIECE_VALUES[piece.type] || 0;
                const bonus = this.getPositionBonus(row, col, piece.type, piece.color, false);

                if (piece.color === aiColor) {
                    score += value + bonus;
                } else {
                    score -= value + bonus;
                }
            }
        }
        return score;
    }

    /**
     * Fonction d'évaluation appropriée selon le niveau
     */
    evaluate(board, aiColor) {
        if (this.difficulty >= AI_DIFFICULTY.HARD) {
            return this.evaluateBoardAdvanced(board, aiColor);
        }
        return this.evaluateBoard(board, aiColor);
    }

    /**
     * Profondeur de recherche selon la difficulté.
     */
    getMaxDepth() {
        switch (this.difficulty) {
            case 1: return 1;  // Easy
            case 2: return 2;  // Medium
            case 3: return 4;  // Hard — augmenté de 3 à 4
            case 4: return 5;  // Expert — augmenté de 4 à 5 (+ iterative deepening)
            default: return 2;
        }
    }

    /**
     * Clone l'état complet d'un engine pour la simulation.
     */
    cloneEngine(engine) {
        const clone = new ChessEngine();
        clone.board = engine.board.map(row => row.map(cell => cell ? { ...cell } : null));
        clone.turn = engine.turn;
        clone.castlingRights = {
            white: { ...engine.castlingRights.white },
            black: { ...engine.castlingRights.black }
        };
        clone.enPassantTarget = engine.enPassantTarget ? { ...engine.enPassantTarget } : null;
        clone.halfMoveClock = engine.halfMoveClock;
        clone.fullMoveNumber = engine.fullMoveNumber;
        clone.moveHistory = [];
        clone.lastMove = engine.lastMove ? { ...engine.lastMove } : null;
        clone.gameOver = engine.gameOver;
        clone.result = engine.result;
        clone.winner = engine.winner;
        return clone;
    }

    /**
     * Clé de move pour history heuristic
     */
    moveKey(move) {
        return `${move.from.row}${move.from.col}${move.to.row}${move.to.col}`;
    }

    /**
     * Tri des coups avancé (captures MVV-LVA, killer moves, history heuristic)
     */
    sortMoves(moves, engine, ply, ttBestMove) {
        const scored = moves.map(move => {
            let score = 0;

            // TT best move gets highest priority
            if (ttBestMove &&
                move.from.row === ttBestMove.from.row &&
                move.from.col === ttBestMove.from.col &&
                move.to.row === ttBestMove.to.row &&
                move.to.col === ttBestMove.to.col) {
                score = 1000000;
            }

            // MVV-LVA (Most Valuable Victim - Least Valuable Attacker)
            const target = engine.board[move.to.row][move.to.col];
            if (target) {
                const victimValue = PIECE_VALUES[target.type] || 0;
                const attackerPiece = engine.board[move.from.row][move.from.col];
                const attackerValue = attackerPiece ? (PIECE_VALUES[attackerPiece.type] || 0) : 0;
                score += 10000 + victimValue * 10 - attackerValue;
            }

            // En passant captures
            if (move.isEnPassant) {
                score += 10000 + PIECE_VALUES['P'] * 10;
            }

            // Promotions
            if (move.promotion) {
                score += 9000;
            }

            // Killer moves (non-captures that caused beta cutoff)
            if (this.killerMoves[ply]) {
                for (const killer of this.killerMoves[ply]) {
                    if (killer &&
                        move.from.row === killer.from.row &&
                        move.from.col === killer.from.col &&
                        move.to.row === killer.to.row &&
                        move.to.col === killer.to.col) {
                        score += 5000;
                        break;
                    }
                }
            }

            // History heuristic
            const key = this.moveKey(move);
            if (this.historyTable[key]) {
                score += this.historyTable[key];
            }

            return { move, score };
        });

        scored.sort((a, b) => b.score - a.score);
        return scored.map(s => s.move);
    }

    /**
     * Quiescence search — continue searching captures to avoid horizon effect.
     * Always evaluates from aiColor's perspective.
     */
    quiescenceSearch(engine, alpha, beta, aiColor, maxQDepth) {
        const standPat = this.evaluate(engine.board, aiColor);
        if (maxQDepth <= 0) return standPat;
        if (standPat >= beta) return beta;
        if (standPat > alpha) alpha = standPat;

        const allMoves = engine.getAllLegalMoves();
        const captureMoves = allMoves.filter(m => {
            const target = engine.board[m.to.row][m.to.col];
            return target || m.isEnPassant || m.promotion;
        });

        // Sort captures by MVV-LVA
        captureMoves.sort((a, b) => {
            let sa = 0, sb = 0;
            const ta = engine.board[a.to.row][a.to.col];
            const tb = engine.board[b.to.row][b.to.col];
            if (ta) sa = PIECE_VALUES[ta.type] || 0;
            if (a.isEnPassant) sa = PIECE_VALUES['P'];
            if (a.promotion) sa += 900;
            if (tb) sb = PIECE_VALUES[tb.type] || 0;
            if (b.isEnPassant) sb = PIECE_VALUES['P'];
            if (b.promotion) sb += 900;
            return sb - sa;
        });

        for (const move of captureMoves) {
            const copy = this.cloneEngine(engine);
            const promotion = move.promotion ? 'Q' : undefined;
            if (!copy.makeMove(move.from, move.to, promotion)) continue;

            const score = this.quiescenceSearch(copy, alpha, beta, aiColor, maxQDepth - 1);
            if (score >= beta) return beta;
            if (score > alpha) alpha = score;
        }
        return alpha;
    }

    /**
     * Minimax avec alpha-beta pruning (niveaux Easy/Medium).
     */
    minimaxBasic(engine, depth, alpha, beta, maximizing, aiColor) {
        const allMoves = engine.getAllLegalMoves();

        if (allMoves.length === 0) {
            if (engine.isInCheck(engine.turn)) {
                const maxDepth = this.getMaxDepth();
                return maximizing
                    ? (-100000 + (maxDepth - depth))
                    : (100000 - (maxDepth - depth));
            }
            return 0;
        }

        if (depth === 0) {
            return this.evaluateBoard(engine.board, aiColor);
        }

        // Simple move ordering: captures first
        allMoves.sort((a, b) => {
            let scoreA = 0, scoreB = 0;
            const targetA = engine.board[a.to.row][a.to.col];
            const targetB = engine.board[b.to.row][b.to.col];
            if (targetA) scoreA += 10 * (PIECE_VALUES[targetA.type] || 0);
            if (a.isEnPassant) scoreA += 10 * PIECE_VALUES['P'];
            if (a.promotion) scoreA += 900;
            if (targetB) scoreB += 10 * (PIECE_VALUES[targetB.type] || 0);
            if (b.isEnPassant) scoreB += 10 * PIECE_VALUES['P'];
            if (b.promotion) scoreB += 900;
            return scoreB - scoreA;
        });

        if (maximizing) {
            let maxEval = -Infinity;
            for (const move of allMoves) {
                const copy = this.cloneEngine(engine);
                copy.makeMove(move.from, move.to, move.promotion || undefined);
                const eval_ = this.minimaxBasic(copy, depth - 1, alpha, beta, false, aiColor);
                maxEval = Math.max(maxEval, eval_);
                alpha = Math.max(alpha, eval_);
                if (beta <= alpha) break;
            }
            return maxEval;
        } else {
            let minEval = Infinity;
            for (const move of allMoves) {
                const copy = this.cloneEngine(engine);
                copy.makeMove(move.from, move.to, move.promotion || undefined);
                const eval_ = this.minimaxBasic(copy, depth - 1, alpha, beta, true, aiColor);
                minEval = Math.min(minEval, eval_);
                beta = Math.min(beta, eval_);
                if (beta <= alpha) break;
            }
            return minEval;
        }
    }

    /**
     * Alpha-Beta avancé avec TT, killer moves, null-move pruning (Hard/Expert).
     */
    alphaBeta(engine, depth, alpha, beta, maximizing, aiColor, ply, allowNullMove) {
        this.nodesSearched++;

        const allMoves = engine.getAllLegalMoves();

        // Terminal nodes
        if (allMoves.length === 0) {
            if (engine.isInCheck(engine.turn)) {
                return maximizing
                    ? (-100000 + ply)
                    : (100000 - ply);
            }
            return 0; // Stalemate
        }

        // Leaf node: use quiescence search for Hard/Expert
        if (depth <= 0) {
            const qDepth = this.difficulty >= AI_DIFFICULTY.EXPERT ? 6 : 4;
            return this.quiescenceSearch(engine, alpha, beta, aiColor, qDepth);
        }

        // Transposition table probe (Expert only)
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

        // Null-move pruning (Expert, depth >= 3, not in check, not endgame)
        if (this.difficulty >= AI_DIFFICULTY.EXPERT &&
            allowNullMove && depth >= 3 && maximizing &&
            !engine.isInCheck(engine.turn) &&
            this.getTotalMaterial(engine.board) > 2600) {
            const R = 2; // Reduction
            const nullCopy = this.cloneEngine(engine);
            // Skip turn
            nullCopy.turn = nullCopy.turn === 'white' ? 'black' : 'white';
            const nullScore = this.alphaBeta(nullCopy, depth - 1 - R, alpha, beta,
                false, aiColor, ply + 1, false);

            if (nullScore >= beta) {
                return beta; // Null-move cutoff
            }
        }

        // Advanced move sorting
        const sortedMoves = this.difficulty >= AI_DIFFICULTY.HARD
            ? this.sortMoves(allMoves, engine, ply, ttBestMove)
            : allMoves;

        let bestScore = maximizing ? -Infinity : Infinity;
        let bestMove = null;
        let moveIndex = 0;

        for (const move of sortedMoves) {
            const copy = this.cloneEngine(engine);
            const promotion = move.promotion ? 'Q' : undefined;
            if (!copy.makeMove(move.from, move.to, promotion)) continue;

            let score;

            // Late Move Reduction (for Expert, non-capture, non-promotion, non-check moves)
            const isCapture = engine.board[move.to.row][move.to.col] || move.isEnPassant;
            const isPromo = !!move.promotion;
            const givesCheck = copy.isInCheck(copy.turn);
            
            if (this.difficulty >= AI_DIFFICULTY.EXPERT &&
                moveIndex >= 4 && depth >= 3 &&
                !isCapture && !isPromo && !givesCheck) {
                // Search with reduced depth first
                score = this.alphaBeta(copy, depth - 2, alpha, beta, !maximizing, aiColor, ply + 1, true);
                
                // Re-search at full depth if it looks promising
                if (maximizing ? score > alpha : score < beta) {
                    score = this.alphaBeta(copy, depth - 1, alpha, beta, !maximizing, aiColor, ply + 1, true);
                }
            } else {
                score = this.alphaBeta(copy, depth - 1, alpha, beta, !maximizing, aiColor, ply + 1, true);
            }

            if (maximizing) {
                if (score > bestScore) {
                    bestScore = score;
                    bestMove = move;
                }
                alpha = Math.max(alpha, score);
            } else {
                if (score < bestScore) {
                    bestScore = score;
                    bestMove = move;
                }
                beta = Math.min(beta, score);
            }

            if (beta <= alpha) {
                // Store killer move (non-capture)
                if (!isCapture) {
                    if (!this.killerMoves[ply]) this.killerMoves[ply] = [null, null];
                    this.killerMoves[ply][1] = this.killerMoves[ply][0];
                    this.killerMoves[ply][0] = move;

                    // Update history heuristic
                    const key = this.moveKey(move);
                    this.historyTable[key] = (this.historyTable[key] || 0) + depth * depth;
                }
                break;
            }

            moveIndex++;
        }

        // Store in transposition table
        if (this.difficulty >= AI_DIFFICULTY.EXPERT && bestMove) {
            let flag = TT_EXACT;
            if (bestScore <= alpha) flag = TT_ALPHA;
            else if (bestScore >= beta) flag = TT_BETA;
            this.tt.set(engine, depth, bestScore, flag, bestMove);
        }

        return bestScore;
    }

    /**
     * Trouve le meilleur coup pour la couleur de l'IA.
     * @param {ChessEngine} engine - Le moteur d'échecs actuel
     * @param {string} aiColor - 'white' ou 'black'
     * @returns {object|null} Le meilleur coup { from, to, promotion }
     */
    findBestMove(engine, aiColor) {
        const allMoves = engine.getAllLegalMoves();
        if (allMoves.length === 0) return null;

        this.nodesSearched = 0;

        // Easy/Medium: simple minimax
        if (this.difficulty <= AI_DIFFICULTY.MEDIUM) {
            return this.findBestMoveBasic(engine, aiColor, allMoves);
        }

        // Hard/Expert: advanced search
        return this.findBestMoveAdvanced(engine, aiColor, allMoves);
    }

    /**
     * Recherche basique pour Easy/Medium
     */
    findBestMoveBasic(engine, aiColor, allMoves) {
        const depth = this.getMaxDepth();
        let bestScore = -Infinity;
        let bestMoves = [];
        let alpha = -Infinity;
        let beta = Infinity;

        for (const move of allMoves) {
            const promotion = move.promotion ? 'Q' : undefined;
            const copy = this.cloneEngine(engine);
            if (!copy.makeMove(move.from, move.to, promotion)) continue;

            let score;
            if (depth <= 1) {
                score = this.evaluateBoard(copy.board, aiColor);
            } else {
                score = this.minimaxBasic(copy, depth - 1, alpha, beta, false, aiColor);
            }

            if (score > bestScore) {
                bestScore = score;
                bestMoves = [{ from: move.from, to: move.to, promotion }];
            } else if (score === bestScore) {
                bestMoves.push({ from: move.from, to: move.to, promotion });
            }

            alpha = Math.max(alpha, score);
        }

        if (bestMoves.length === 0) {
            const m = allMoves[0];
            return { from: m.from, to: m.to, promotion: m.promotion ? 'Q' : undefined };
        }

        return bestMoves[Math.floor(Math.random() * bestMoves.length)];
    }

    /**
     * Recherche avancée pour Hard/Expert avec iterative deepening
     */
    findBestMoveAdvanced(engine, aiColor, allMoves) {
        const maxDepth = this.getMaxDepth();

        // Reset heuristics
        this.historyTable = {};
        this.killerMoves = [];
        if (this.difficulty >= AI_DIFFICULTY.EXPERT) {
            this.tt.clear();
        }

        let bestMove = null;
        let bestScore = -Infinity;

        // Iterative deepening: search from depth 1 up to maxDepth
        // Each iteration's move ordering improves the next one
        for (let depth = 1; depth <= maxDepth; depth++) {
            let currentBest = null;
            let currentBestScore = -Infinity;
            let alpha = -Infinity;
            let beta = Infinity;

            // Sort moves using results from previous iteration
            const sortedMoves = this.sortMoves(allMoves, engine, 0,
                bestMove ? { from: bestMove.from, to: bestMove.to } : null
            );

            for (const move of sortedMoves) {
                const promotion = move.promotion ? 'Q' : undefined;
                const copy = this.cloneEngine(engine);
                if (!copy.makeMove(move.from, move.to, promotion)) continue;

                const score = this.alphaBeta(copy, depth - 1, alpha, beta, false, aiColor, 1, true);

                if (score > currentBestScore) {
                    currentBestScore = score;
                    currentBest = { from: move.from, to: move.to, promotion };
                }

                alpha = Math.max(alpha, score);
            }

            if (currentBest) {
                bestMove = currentBest;
                bestScore = currentBestScore;
            }

            // If we found a forced mate, stop searching deeper
            if (bestScore >= 90000) break;
        }

        if (!bestMove) {
            const m = allMoves[0];
            return { from: m.from, to: m.to, promotion: m.promotion ? 'Q' : undefined };
        }

        return bestMove;
    }
}
