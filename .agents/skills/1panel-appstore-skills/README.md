# 1Panel Appstore Skills

[English](./README.md) | [简体中文](./README.zh-CN.md)

`1panel-appstore-skills` is a skill for creating 1Panel App Store app installation packages.

It is designed for applications that already support Docker-based deployment. It can generate a package that follows the 1Panel App Store app format from official repositories, official documentation, Docker images, `docker-compose.yml`, or a prepared intermediate spec.

## When to Use

Suitable for:

- Packaging a Dockerized application as a 1Panel App Store app.
- Converting Docker / Docker Compose installation methods from official repositories or official documentation into a 1Panel app package.
- Organizing an existing `docker-compose.yml` into the 1Panel App Store directory structure.
- Generating `data.yml`, `docker-compose.yml`, README files, and data directories from a prepared app spec.

Not suitable for:

- Applications without a reliable Docker-based installation method.
- Scenarios that require inventing the application deployment architecture, image, ports, data directories, or environment variables.
- Publishing to a remote app store repository. This skill only generates app package content.

## Supported Inputs

- Application name or official repository URL.
- Docker image and required deployment parameters.
- Official `docker-compose.yml` / `compose.yml` file.
- Intermediate JSON spec that follows `references/appspec.md`.

## Output

The generated result is a 1Panel App Store app package directory. The default structure is:

```text
apps/<app-key>/
  logo.png
  README.md
  README_en.md
  data.yml
  <version>/
    data.yml
    docker-compose.yml
    data/
    scripts/        # Optional: generate init.sh when persistent directory permissions need to be handled
```

Based on the input and official sources, it handles:

- Basic app information, version, type, tags, website, documentation, and repository URL.
- Main service and dependent service images, ports, environment variables, data volumes, and startup dependencies.
- `data.yml` fields, form fields, and multilingual descriptions required by 1Panel.
- Chinese README; English README when the official application or documentation supports English.
- Persistent directory permission initialization script, generated only when official sources prove it is required.

## Project Layout

```text
1panel-appstore-skills/
  README.md
  README.zh-CN.md
  SKILL.md
  assets/
  references/
  scripts/
```

Core files:

- `SKILL.md`: defines trigger scenarios, workflow, and packaging rules.
- `assets/sample-appspec.json`: intermediate spec example, useful for understanding the generation flow.
- `references/appstore-format.md`: 1Panel app package directory and field rules.
- `references/source-policy.md`: source rules for application source code, official documentation, and Docker installation methods.
- `scripts/generate_app_package.py`: generates a 1Panel app package from an intermediate spec.

## Source Requirements

Docker installation methods in the app package must come from the application’s official repository or official documentation.

If a repository URL is provided, use that repository as the primary source. Only when no repository URL is provided should mainstream open-source code hosts such as GitHub, Gitee, and GitLab be searched, and the discovered repository must be confirmed as official.

Useful sources include repository `README`, `docs`, `docker-compose.yml`, `compose.yml`, `Dockerfile`, `.env.example`, deployment documentation, and official documentation pages that explicitly provide Docker / Docker Compose installation instructions. Container runtime user, UID/GID, and data directory permission requirements must also come from official `Dockerfile`, Compose files, image documentation, or project documentation.

When official sources do not provide a Docker installation method, reliable containerized installation information must be added before generating the app package.

Prefer official container images. If no public official image is available, or if the official project only provides source-build instructions, a third-party image can be used only after the user explicitly accepts it, and the third-party image source must be recorded.

If `init.sh` is generated, its content also needs official-source evidence. The most common use is handling persistent directory permissions. If official documentation clearly requires other pre-installation actions, those commands can also be included. When no initialization action is needed, the app package does not include a `scripts/` directory.

## Usage Examples

```text
Package https://github.com/example/myapp as a 1Panel App Store app.
```

```text
Package OpenClaw as a 1Panel App Store app.
```

```text
Package ghcr.io/example/myapp:1.0.0 as a 1Panel App Store app.
Host port 8080, container port 3000.
```

```text
Use 1panel-appstore-skills to convert the docker-compose.yml in the current directory into a 1Panel App Store app package.
```

## Generate

If an intermediate spec is already prepared, run:

```bash
python3 scripts/generate_app_package.py \
  --spec assets/sample-appspec.json \
  --output apps
```

The generated package directory will be:

```text
apps/<app-key>
```

## Local Test

Place the generated app directory in:

```text
/opt/1panel/resource/apps/local/<app-key>
```

Then refresh the local app list in the 1Panel App Store, and test install, start, stop, restart, and uninstall.
