#!/bin/bash
# Lance le serveur d'échecs en ligne (WebSocket + HTTP)
# Usage: ./start_online.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEB_DIR="$SCRIPT_DIR/web"

echo "♛  Démarrage du serveur d'échecs en ligne..."
echo ""

# Vérifier Python
if ! command -v python3 &> /dev/null; then
    echo "Erreur: Python 3 n'est pas installé."
    exit 1
fi

# Vérifier aiohttp
python3 -c "import aiohttp" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "Installation de la bibliothèque aiohttp..."
    pip3 install --break-system-packages aiohttp
fi

cd "$WEB_DIR"
export PORT=${PORT:-8080}
echo "  Port: $PORT"
echo ""
python3 server.py
