#!/usr/bin/env bash
# CPA restart（等同于 ./cpactl.sh restart）
exec "$(cd "$(dirname "$0")" && pwd)/cpactl.sh" restart "$@"
