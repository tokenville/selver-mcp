#!/bin/bash
if [ -f /tmp/selver-miniapp.pids ]; then
    kill $(cat /tmp/selver-miniapp.pids) 2>/dev/null
    rm /tmp/selver-miniapp.pids
    echo "MiniApp stopped"
else
    echo "No running MiniApp found"
fi
