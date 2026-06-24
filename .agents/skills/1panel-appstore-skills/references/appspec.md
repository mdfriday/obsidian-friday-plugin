# Intermediate App Spec

Use this JSON spec as the handoff between natural-language analysis and deterministic package generation.

## Minimal Example

```json
{
  "key": "myapp",
  "name": "MyApp",
  "title": "MyApp",
  "version": "1.0.0",
  "description": {
    "en": "Self-hosted MyApp service",
    "es-es": "Servicio MyApp autoalojado",
    "ja": "セルフホスト型 MyApp サービス",
    "ms": "Perkhidmatan MyApp hos kendiri",
    "pt-br": "Servico MyApp auto-hospedado",
    "ru": "Самостоятельно размещаемый сервис MyApp",
    "ko": "셀프 호스팅 MyApp 서비스",
    "zh-Hant": "自託管 MyApp 服務",
    "zh": "自托管 MyApp 服务",
    "tr": "Kendi barindirdiginiz MyApp servisi"
  },
  "readme": {
    "zh": {
      "introduction": "是一款自托管应用服务。",
      "features": [
        {
          "title": "容器化部署",
          "description": "支持通过 Docker 方式部署和运行。"
        }
      ]
    },
    "en": {
      "introduction": "is a self-hosted application service.",
      "features": [
        {
          "title": "Containerized Deployment",
          "description": "Supports deployment and runtime through Docker."
        }
      ]
    }
  },
  "type": "tool",
  "tags": ["Tool"],
  "website": "https://example.com",
  "github": "https://github.com/example/myapp",
  "document": "https://docs.example.com",
  "source_evidence": [
    "https://github.com/example/myapp/blob/main/docker-compose.yml",
    "https://docs.example.com/install/docker"
  ],
  "init_source_evidence": [
    "https://github.com/example/myapp/blob/main/Dockerfile"
  ],
  "architectures": ["amd64", "arm64"],
  "services": [
    {
      "name": "myapp",
      "image": "ghcr.io/example/myapp:1.0.0",
      "primary": true,
      "user": "1000:1000",
      "ports": [
        {
          "host_env": "PANEL_APP_PORT_HTTP",
          "host_default": 8080,
          "container": 3000,
          "protocol": "tcp",
          "label": "Port"
        }
      ],
      "volumes": [
        "./data:/app/data"
      ],
      "volume_permissions": [
        {
          "path": "./data",
          "owner": "1000:1000",
          "mode": "755"
        }
      ],
      "environment": {
        "APP_ENV": "production",
        "APP_SECRET": "${APP_SECRET}"
      }
    }
  ],
  "form_fields": [
    {
      "default": "myapp",
      "envKey": "APP_SECRET",
      "labelEn": "App Secret",
      "labelZh": "App Secret",
      "random": true,
      "required": true,
      "type": "password"
    }
  ]
}
```

## Fields

- `key`: required. Lowercase app key and folder name.
- `name`: required. Display name.
- `title`: optional; defaults to `name`.
- `version`: required. Do not prefix with `v`.
- `description`: string or i18n object. Prefer the full appstore language map.
- `readme`: optional object with `zh` and `en` sections. Each section supports `introduction` and `features`; use official app README/docs as the source.
- `english_supported`: optional boolean. Defaults to true. Set false only when the upstream app and official docs do not support English.
- `type`: `website`, `runtime`, or `tool` unless the repo already uses a more specific accepted value.
- `tags`: list of appstore tag keys.
- `services`: required. One or more Docker services.
- `form_fields`: optional. Extra fields for version `data.yml`; port fields are auto-added from service `ports`.
- `logo`: optional local path to a PNG file. If absent, the generator creates a tiny placeholder PNG.
- `source_evidence`: optional but strongly recommended. List the repository files or official docs used to determine Docker image, ports, volumes, environment variables, and dependencies.
- `notes`: optional package assumptions or warnings for the spec/final response. The generator does not write these into app README files.
- `init_commands`: optional list of shell lines to include in `scripts/init.sh`. Use only for official host-side preflight actions.
- `init_source_evidence`: required when `init_commands`, `init_permissions`, or `volume_permissions` generate an `init.sh`. List the official repository files or docs that justify the init actions.
- `init_permissions`: optional list of persisted host paths that need ownership or mode changes before the container starts. Use only when official Docker evidence confirms the container writes as a non-root user.

## Service Fields

- `name`: service key.
- `image`: pinned image reference.
- `primary`: true for the main app service.
- `ports`: list of host/container port mappings.
- `volumes`: list of compose-style relative mounts.
- `environment`: object or list.
- `command`, `entrypoint`: string or list.
- `user`: optional Compose runtime user, when required by the official image or Compose file.
- `depends_on`: list of service names.
- `healthcheck`: compose-compatible object.
- `volume_permissions`: optional service-local list of host paths to fix in `scripts/init.sh`.

## I18n Fields

Root `description` and every form field `label` should cover:

```text
en, es-es, ja, ms, pt-br, ru, ko, zh-Hant, zh, tr
```

For app-specific text, provide reviewed translations in the spec when available. If there is no reliable translation source, use the official English text as fallback instead of inventing details.
