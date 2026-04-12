# Remote Access via Tailscale

Access the Knotes web app from a Windows desktop over a Tailscale VPN. The web server binds to `127.0.0.1` only — Tailscale Funnel or subnet routing is not needed; we use Tailscale's peer-to-peer connectivity combined with SSH forwarding or Tailscale Serve.

## Option A: Tailscale Serve (recommended)

Tailscale Serve exposes a local port to your tailnet without SSH. This is the simplest approach.

### 1. Install Tailscale on the Linux server

```sh
# Debian/Ubuntu
curl -fsSL https://tailscale.com/install.sh | sh

# Start and authenticate
sudo tailscale up

# Confirm it's running — note the Tailscale IP (e.g. 100.x.y.z)
tailscale ip -4
```

### 2. Start Knotes and expose it via Tailscale Serve

```sh
# Start the web app (binds to 127.0.0.1:7713)
knotes web &

# Expose port 7713 to your tailnet on port 7713
sudo tailscale serve --bg 7713
```

This makes `http://<server-tailscale-hostname>:7713` accessible to any device on your tailnet.

To stop serving:

```sh
sudo tailscale serve --bg off 7713
```

### 3. Install Tailscale on the Windows desktop

1. Download the installer from https://tailscale.com/download/windows
2. Run the installer and follow the prompts
3. Sign in with the same account/tailnet used on the Linux server
4. Open a browser and navigate to `http://<server-tailscale-hostname>:7713`

You can find the server's Tailscale hostname in the Tailscale admin console or by running `tailscale status` on either machine.

---

## Option B: SSH forwarding over Tailscale

If you prefer not to use Tailscale Serve, you can forward the port over SSH. Tailscale provides connectivity between the machines; SSH provides the tunnel.

### 1. Install Tailscale on both machines

Follow the same install steps as Option A for both the Linux server and Windows desktop.

### 2. Enable Tailscale SSH (optional, avoids managing SSH keys)

On the Linux server:

```sh
sudo tailscale up --ssh
```

This lets other tailnet members SSH in without configuring keys — access is controlled by Tailscale ACLs.

If you skip this, ensure the Linux server has a standard SSH server running (`sudo apt install openssh-server`).

### 3. Start Knotes on the server

```sh
knotes web
```

### 4. Create an SSH tunnel from Windows

Open PowerShell or Windows Terminal:

```powershell
ssh -L 7713:127.0.0.1:7713 user@<server-tailscale-hostname>
```

Replace `user` with your Linux username. If using Tailscale SSH, the username is your tailnet identity.

Then open a browser on the Windows machine and go to `http://localhost:7713`.

The tunnel stays open as long as the SSH session is active.

---

## Verify connectivity

From the Windows machine, confirm Tailscale can reach the server:

```powershell
tailscale ping <server-tailscale-hostname>
```

If this succeeds, either option above will work.

## Tailscale admin

- Manage devices and ACLs at https://login.tailscale.com/admin
- Both machines must be on the same tailnet (signed in with the same account or accepted via sharing)
- Tailscale uses WireGuard under the hood — traffic is encrypted end-to-end
