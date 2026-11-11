#!/usr/bin/env bash
# CPA stop（等同于 ./cpactl.sh stop）
exec "$(cd "$(dirname "$0")" && pwd)/cpactl.sh" stop "$@"
