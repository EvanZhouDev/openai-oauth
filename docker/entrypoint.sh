#!/bin/sh
set -eu

# Normalize proxy env (Docker/compose often set lowercase; Node/tools vary).
if [ -n "${http_proxy:-}" ] && [ -z "${HTTP_PROXY:-}" ]; then
	export HTTP_PROXY="$http_proxy"
fi
if [ -n "${https_proxy:-}" ] && [ -z "${HTTPS_PROXY:-}" ]; then
	export HTTPS_PROXY="$https_proxy"
fi
if [ -n "${no_proxy:-}" ] && [ -z "${NO_PROXY:-}" ]; then
	export NO_PROXY="$no_proxy"
fi
if [ -n "${HTTP_PROXY:-}" ] && [ -z "${http_proxy:-}" ]; then
	export http_proxy="$HTTP_PROXY"
fi
if [ -n "${HTTPS_PROXY:-}" ] && [ -z "${https_proxy:-}" ]; then
	export https_proxy="$HTTPS_PROXY"
fi
if [ -n "${NO_PROXY:-}" ] && [ -z "${no_proxy:-}" ]; then
	export no_proxy="$NO_PROXY"
fi

# Make Node fetch/http honor proxy env vars (Node 22.21+ / 24+).
export NODE_USE_ENV_PROXY="${NODE_USE_ENV_PROXY:-1}"

# Always load proxy bootstrap so fetch uses EnvHttpProxyAgent when a proxy is set.
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--import /app/docker/proxy-bootstrap.mjs"

exec "$@"
