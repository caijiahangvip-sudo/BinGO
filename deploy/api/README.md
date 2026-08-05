# BinGO Cloud API

This deployment runs the full Next.js BinGO web application and its `/api/*` routes. The iPad bootstrap can open the same HTTPS origin as its full client and API base.

## Start

```sh
cp .env.example .env
# Set BINGO_API_TOKEN and BINGO_CORS_ORIGINS in .env.
docker compose up -d --build
```

The service listens on port `4000` by default. Put it behind HTTPS before configuring the iPad.

## iPad configuration

- `BinGO 云端页面地址`: the public HTTPS origin serving the full BinGO app.
- `云端 API 地址`: normally the same origin; use a separate API origin only when the deployment is split.
- `云端 API 令牌`: the value of `BINGO_API_TOKEN` when token protection is enabled.

The Windows desktop build does not use this deployment path; it keeps its local session token and bundled services.
