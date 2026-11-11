#!/usr/bin/env bash
# CPA start（等同于 ./cpactl.sh start）
exec "$(cd "$(dirname "$0")" && pwd)/cpactl.sh" start "$@"
