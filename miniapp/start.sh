#!/bin/bash
# Start MiniApp server and Cloudflare tunnel

# Start Bun server
cd /home/takoitatakoita/selver-assistant/miniapp
bun run server.ts &
SERVER_PID=$!
echo "MiniApp server started on :3100 (PID $SERVER_PID)"

# Wait for server to be ready
sleep 2

# Start Cloudflare tunnel (trycloudflare.com — free, no auth)
TUNNEL_OUTPUT=$(mktemp)
cloudflared tunnel --url http://localhost:3100 2>&1 | tee $TUNNEL_OUTPUT &
TUNNEL_PID=$!

# Wait for tunnel URL
sleep 5
TUNNEL_URL=$(grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' $TUNNEL_OUTPUT | head -1)

if [ -n "$TUNNEL_URL" ]; then
    echo "Tunnel URL: $TUNNEL_URL"

    # Register MiniApp button on Telegram bot
    BOT_TOKEN=$(grep TELEGRAM_BOT_TOKEN /home/takoitatakoita/selver-assistant/.telegram/.env | cut -d= -f2)
    curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setChatMenuButton" \
        -H "Content-Type: application/json" \
        -d "{\"menu_button\":{\"type\":\"web_app\",\"text\":\"Кладовая\",\"url\":\"${TUNNEL_URL}\"}}"
    echo ""
    echo "Bot menu button set to: $TUNNEL_URL"
else
    echo "Failed to get tunnel URL"
fi

# Save PIDs for cleanup
echo "$SERVER_PID $TUNNEL_PID" > /tmp/selver-miniapp.pids
echo "PIDs saved. To stop: kill $(cat /tmp/selver-miniapp.pids)"

wait
