# Deployment

## Local systemd service

This checkout is installed at `/home/devops/workspace/openai-oauth` and uses
`/home/devops/.codex/auth.json`.

```bash
curl -fsSL https://bun.sh/install | bash -s "bun-v1.2.18"
PATH=/home/devops/.bun/bin:$PATH bun install
cd packages/openai-oauth
PATH=/home/devops/.bun/bin:$PATH bun run build

sudo cp deploy/openai-oauth.service /etc/systemd/system/openai-oauth.service
sudo systemctl daemon-reload
sudo systemctl enable --now openai-oauth.service
```

Check the service:

```bash
systemctl status openai-oauth.service --no-pager
curl http://127.0.0.1:10531/v1/models
```

## Public reverse proxy with Caddy

Keep `openai-oauth` bound to `127.0.0.1:10531`. Put Caddy in front of it and
require a bearer token before proxying requests.

```bash
sudo apt-get install -y caddy
sudo cp deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo editor /etc/caddy/Caddyfile
sudo systemctl enable --now caddy
sudo systemctl reload caddy
```

For a real domain with automatic HTTPS, replace `:80` with the domain:

```caddyfile
api.example.com {
	# same handlers as deploy/Caddyfile.example
}
```

Client environment:

```env
OPENAI_BASE_URL=http://YOUR_SERVER_OR_DOMAIN/v1
OPENAI_API_KEY=dsket-replace-with-your-local-placeholder-key
```

### Public URL request and response shape

When using a public reverse proxy, clients call the reverse proxy URL and pass
the bearer token checked by Caddy or nginx:

```bash
curl http://YOUR_SERVER_OR_DOMAIN/v1/models \
  -H "Authorization: Bearer dsket-replace-with-your-local-placeholder-key"
```

Text requests use the OpenAI-compatible `/v1/responses` or
`/v1/chat/completions` routes. Image generation uses `/v1/images/generations`:

```bash
curl http://YOUR_SERVER_OR_DOMAIN/v1/images/generations \
  -H "Authorization: Bearer dsket-replace-with-your-local-placeholder-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.4",
    "prompt": "Generate a simple image of a blue square on a white background.",
    "size": "1024x1024",
    "quality": "low"
  }'
```

The image response is JSON:

```json
{
  "created": 1760000000,
  "data": [
    {
      "b64_json": "...base64 image data...",
      "revised_prompt": "Generate a simple image of a blue square on a white background."
    }
  ]
}
```

The default implementation calls Codex `/responses` with the
`image_generation` tool behind an `ImageGenerationGateway` interface, so a
deployment can replace the gateway without changing the public route.

## Docker

The OAuth file is not baked into the image. Mount it at runtime.

```bash
docker build -t openai-oauth:local .
docker run --rm -p 10531:10531 \
  -v /home/devops/.codex/auth.json:/home/node/.codex/auth.json:ro \
  openai-oauth:local
```
