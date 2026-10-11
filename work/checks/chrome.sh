#!/bin/sh
# Container runs as root: Chromium refuses to start without --no-sandbox.
# Wrapper used as CHROME_PATH for the Anatomy capture/drive/lines scripts.
exec /opt/pw-browsers/chromium-1194/chrome-linux/chrome --no-sandbox "$@"
