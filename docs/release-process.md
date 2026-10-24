# Release and branch protection

The default branch is `main`; this repository has no `master` branch. Push work
to a feature branch and merge it through a pull request after the required CI
checks pass.

## Protect `main` in GitHub

Repository branch rules are GitHub settings and are not stored in this checkout.
Create a branch protection rule for the exact branch name `main` in the
repository's **Settings → Branches** page, with these options:

- Require a pull request before merging. No approving review is required for a
  single-maintainer workflow.
- Require the `verify` and `arm64-build` status checks.
- Require the branch to be up to date before merging.
- Block force pushes and branch deletion.
- Enable **Do not allow bypassing the above settings** so administrators also
  use pull requests and pass checks.

The `verify` job includes formatting, lint, type checks, unit and integration
tests, UI tests, BDD scenarios, and an AMD64 Docker build. `arm64-build` checks
that the Raspberry Pi image builds for ARM64. The release workflow opens a
version-bump PR; these same checks must pass before it can be merged.

## Prepare and publish a release

1. Open **Actions → Release → Run workflow** on the `main` branch.
2. Enter a stable version such as `1.0.0`, without a leading `v`.
3. The workflow updates the root and workspace package versions, lockfile,
   README, architecture version, and UI version badge. It creates
   `release/v1.0.0`, opens a PR to `main`, and starts CI for that branch.
4. Merge the PR only after `verify` and `arm64-build` pass. The merge starts
   publication: the workflow creates tag `v1.0.0`, builds and publishes both
   `linux/amd64` and `linux/arm64` images to GHCR, updates the `latest` tag, and
   creates a GitHub Release with generated notes.

The image names are
`ghcr.io/balazsfoldi/home-memory-agent:v1.0.0` and
`ghcr.io/balazsfoldi/home-memory-agent:latest`. A release PR can only be merged
after the GitHub branch rule above is configured. On first publication, make
the GHCR package public if the Pi should pull without registry credentials;
otherwise sign in to `ghcr.io` on the Pi with a token that can read packages.

## Automatic Raspberry Pi updates

The Compose service uses the `latest` image while retaining the existing named
SQLite volume. The systemd timer in `deploy/systemd` checks the registry every
15 minutes and asks Compose to pull and recreate the service only when the
image changes. It expects the project checkout at `/opt/home-memory-agent`.
Change `WorkingDirectory` in the service file if you keep the checkout
elsewhere, then install and enable the timer:

```sh
sudo cp deploy/systemd/home-memory-agent-update.service /etc/systemd/system/
sudo cp deploy/systemd/home-memory-agent-update.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now home-memory-agent-update.timer
systemctl list-timers home-memory-agent-update.timer
```

For a private GHCR package, log in as the same system user that runs the timer.
The included system service defaults to root; edit its `User` and
`SupplementaryGroups=docker` settings if your Pi uses a non-root Docker group.
To inspect update attempts, use
`journalctl -u home-memory-agent-update.service`.
