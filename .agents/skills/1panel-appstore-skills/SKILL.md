---
name: 1panel-appstore-skills
description: Create 1Panel appstore/local-app installation packages for Dockerized applications from official repositories, Docker images, docker-compose.yml files, or a prepared app spec.
metadata:
  openclaw:
    requires:
      bins:
        - python3
---

# 1Panel Appstore Skills

Package Dockerized applications into the 1Panel appstore/local-app format. Use official application sources for installation details and generate the app package from an intermediate spec.

## Workflow

1. Resolve the application source:
   - Repository URL: use the provided repository as the primary source.
   - App name only: search mainstream open-source code hosts and confirm the official repository.
   - Docker image or Compose file: collect the missing app metadata from official docs or the user.
2. Inspect official files/docs for Docker image, Compose topology, ports, volumes, environment variables, runtime user, README content, website, docs, logo, and version.
3. Read only the references needed:
   - `references/source-policy.md` before resolving Docker install details from an app name or repository URL.
   - `references/appstore-format.md` for 1Panel package rules.
   - `references/appspec.md` before writing the intermediate spec.
   - `references/review-checklist.md` before final handoff when you need a packaging checklist.
4. Write an intermediate JSON spec, usually under `/tmp/<app-key>-1panel-appspec.json` or a task-specific output directory.
5. Run `scripts/generate_app_package.py --spec <spec.json> --output <output-dir>` to create the package.
6. Return the package path, generated version, source evidence, warnings, and local testing path.

## Source Rules

- Never invent Docker installation details. Docker image, ports, volumes, environment variables, dependencies, and runtime user must come from the official repository or official docs.
- If the user provides a repository URL, do not switch sources unless that repository links to official docs needed for Docker installation.
- If only an app name is provided, confirm the official repository before packaging. If it cannot be confirmed, ask for the repository URL.
- Do not use third-party tutorials, unrelated Docker Hub pages, mirrors, or guessed Compose snippets.
- Prefer official container images. Use a third-party image only when the official project has no public image or only documents source builds, the user explicitly accepts the third-party image, and the third-party image page or source repository clearly identifies the upstream project.
- Always generate Docker-based packages. If no reliable containerization path exists, stop and state what is missing.

## Package Rules

- Prefer a single primary service when possible. For secondary services, use explicit names and make sure every service joins `1panel-network`.
- Use `${CONTAINER_NAME}` for the primary service container name. Use `${CONTAINER_NAME}-<service>` for secondary service container names.
- Use `PANEL_APP_PORT_HTTP` for the primary web port. Use `PANEL_APP_PORT_<PURPOSE>` for additional ports.
- Every `${...}` variable in `docker-compose.yml` must be declared in version `data.yml`, except known 1Panel-provided values such as `${CONTAINER_NAME}` and service-derived `${PANEL_DB_PORT}`.
- Put user-editable settings in version `data.yml` form fields. Use password fields for secrets.
- Keep persistent data mounts relative, for example `./data:/app/data`.
- Keep generated changes scoped to the app package or skill resources requested by the user.

## README and I18n

- Generate root `README.md` in the concise existing appstore style: `## 产品介绍` and, when useful, `## 主要功能`. Generate `README_en.md` with `## Introduction` and `## Features` when the upstream application website, repository README, or app UI supports English.
- Do not put generated-package diagnostics, source evidence, local testing instructions, or long operational notes in app README files. Keep those in the final response or intermediate spec.
- Fill i18n maps for root `additionalProperties.description` and every version `data.yml` form field `label`. Use the appstore language set `en`, `es-es`, `ja`, `ms`, `pt-br`, `ru`, `ko`, `zh-Hant`, `zh`, and `tr`.
- Reuse translations already present in existing apps for common labels such as Port, HTTP Port, Web UI Port, Password, API Key, Token, Model, Provider, and Base URL. Do not invent specialized translations when no reliable source or existing pattern exists; prefer a clear English fallback and call out the assumption.

## init.sh Rules

- For every persistent relative volume, check whether the container runs as a non-root built-in user. Use official `Dockerfile` `USER`, official Compose `user:`, image docs, or installation docs as evidence. If the mounted directory must be writable by a non-root UID/GID, add an `init_permissions` or service `volume_permissions` entry so `scripts/init.sh` fixes ownership before startup.
- `init.sh` content must be based on official application sources. Use `init_source_evidence` to record the official file or documentation that supports every generated init action.
- Besides persistent directory permissions, add other `init_commands` only when official install docs require a host-side preflight step. Keep the script minimal.
- Do not guess UID/GID values. If the official source does not reveal the runtime user and the app is known to fail on host-mounted volumes, stop and ask the user for the intended UID/GID or official container docs.
- Let the package tree create persistent directories with `.gitkeep`; use `init.sh` to change permissions, not as the primary way to create expected directories.
- If no init action is needed, do not generate `scripts/` or `scripts/init.sh`.

## Scripts

- `scripts/generate_app_package.py`
  - Input: JSON app spec.
  - Output: `apps/<key>/data.yml`, `README.md`, `README_en.md` when applicable, `logo.png`, `<version>/data.yml`, `<version>/docker-compose.yml`, and data directories.
  - Use this instead of hand-writing package files when starting a new app package.
- `scripts/validate_app_package.py`
  - Optional helper for basic generated-package checks.
  - Do not present it as a full 1Panel appstore review or runtime installation test.

## Output Contract

When done, report:

- App package path.
- Generated version.
- Source evidence used for Docker installation details.
- Any warnings or assumptions.
- Local test target: `/opt/1panel/resource/apps/local/<app-key>`.
