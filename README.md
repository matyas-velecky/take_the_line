# take_the_line

## Run with Docker

Build and run the combined frontend and Socket.IO server as one image:

```sh
docker build -t take-the-line .
docker run --rm -p 8000:8000 take-the-line
```

Open `http://localhost:8000`. The container serves the frontend and API on port
`8000`; `/healthz` is available for Kubernetes health probes. The game state is
stored in memory, so run a single replica unless state is moved to a shared
service.

Enter a name to create a private room and share its six-character code, or join
another player's room with their code. Each match starts after a 10-second
countdown when the second player joins. Use the color picker in the top-left
corner to change your player and trail color.
Both players can steer with either WASD or the arrow keys. Players move
automatically; hold left/right to keep turning, or up/down to steer
north/south.
Press Space to jump over trails, or Shift to double your speed for one second.

The same image can be published to a registry and used by a Kubernetes
Deployment. `docker compose up --build` also runs the application as one
service.