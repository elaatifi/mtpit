# LMTPit

A small test workbench for the mail pipeline after receipt. Compose a MIME message or replay an `.eml` file, then deliver it to an LMTP server and inspect each recipient's response.

## Run locally

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. The React UI runs through Vite; the Node API runs on port 3001.

For a production build:

```bash
npm run build
npm start
```

Open <http://localhost:3001>.

## Docker

```bash
make docker-build
docker run --rm --network host elaatifi/mtpit:latest
```

Publish a multi-architecture image to Docker Hub with `make docker-push`. Override
the image tag with `make docker-push TAG=0.1.0`.

The image defaults to `127.0.0.1:8027`, matching Kistrl's local LMTP endpoint. With host networking on Linux, the container shares the host's loopback interface and serves the UI at <http://localhost:3001>. With ordinary bridge networking, `127.0.0.1` means the container itself. Set `LMTP_HOST` to a reachable hostname or IP (for example, another container's name on the same Docker network); a host receiver bound only to loopback cannot be reached through a bridge network.

Configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `LMTP_HOST` | `127.0.0.1` | LMTP hostname |
| `LMTP_PORT` | `8027` | LMTP port |
| `LMTP_SOCKET` | unset | Unix socket path; takes precedence over host and port |
| `PORT` | `3001` | Web server port |

The LMTP connection uses plain TCP or a Unix socket. Delivery history is kept in memory for the current server session (up to 50 entries). Uploaded files are limited to 25 MB each and are processed in memory. For `.eml` replays, blank override fields keep the original headers; a To override also replaces the LMTP envelope recipients. The original MIME body and attachments are retained.

## Checks

```bash
npm test
npm run build
```
