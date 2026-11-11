#!/usr/bin/env bash
# CPA status（等同于 ./cpactl.sh status）
exec "$(cd "$(dirname "$0")" && pwd)/cpactl.sh" status "$@"
