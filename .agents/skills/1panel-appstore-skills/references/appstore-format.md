# 1Panel Appstore Format

Generated packages should follow the local app shape accepted by 1Panel.

```text
apps/<app-key>/
  logo.png
  README.md
  README_en.md
  data.yml
  <version>/
    data.yml
    docker-compose.yml
    <persistent-dir>/
      .gitkeep
    scripts/
      init.sh
```

`README_en.md`, persisted directories, and `scripts/init.sh` are generated only when needed.

## Root `data.yml`

Required fields:

- `name`
- `tags`
- `title`
- `description`
- `additionalProperties.key`
- `additionalProperties.name`
- `additionalProperties.tags`
- `additionalProperties.shortDescZh`
- `additionalProperties.shortDescEn`
- `additionalProperties.description`
- `additionalProperties.type`
- `additionalProperties.crossVersionUpdate`
- `additionalProperties.limit`
- `additionalProperties.architectures`

`additionalProperties.description` must include:

```text
en, es-es, ja, ms, pt-br, ru, ko, zh-Hant, zh, tr
```

## Version `data.yml`

Use `additionalProperties.formFields` for user-editable values.

- Every public port uses `rule: paramPort` and `type: number`.
- Secrets use `type: password`.
- Every form field `label` includes the full appstore language set.
- Every `${...}` variable used in Compose must be declared here, except known 1Panel-provided variables such as `${CONTAINER_NAME}`.

## `docker-compose.yml`

- Primary service uses `container_name: ${CONTAINER_NAME}`.
- Secondary services use `container_name: ${CONTAINER_NAME}-<service>`.
- Every service joins `1panel-network`.
- `1panel-network` is external.
- Every service includes `labels.createdBy: Apps`.
- Public ports use `PANEL_APP_PORT_*`.
- Persisted host paths are relative, such as `./data:/app/data`.

## README Files

Keep app README files concise:

- Chinese: `## 产品介绍`, optional `## 主要功能`.
- English: `## Introduction`, optional `## Features`.

Do not include source evidence, generated-package diagnostics, or local testing notes in app README files.

## Init Script

Generate `<version>/scripts/init.sh` only when official sources require host-side initialization.

Common case:

- A container runs as a non-root user.
- A host-mounted persistent directory must be writable by that user.
- Official Dockerfile, Compose, or image docs provide the numeric UID/GID.

If no init action is needed, do not create `scripts/`.
