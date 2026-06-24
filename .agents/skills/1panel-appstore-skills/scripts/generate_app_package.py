#!/usr/bin/env python3
"""Generate a 1Panel appstore package from a JSON app spec."""

from __future__ import annotations

import argparse
import base64
import json
import re
import shlex
import shutil
import sys
from pathlib import Path
from typing import Any


KEY_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$")
VAR_RE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}")
SECRET_RE = re.compile(r"(PASSWORD|SECRET|TOKEN|KEY|SALT)", re.I)
OWNER_RE = re.compile(r"^[0-9]+:[0-9]+$")
MODE_RE = re.compile(r"^[0-7]{3,4}$")
BUILTIN_VARS = {"CONTAINER_NAME", "HOST_IP", "HOST_ADDRESS", "PANEL_DB_PORT"}
LANG_KEYS = ["en", "es-es", "ja", "ms", "pt-br", "ru", "ko", "zh-Hant", "zh", "tr"]
I18N_LABELS = {
    "Port": {
        "en": "Port",
        "es-es": "Puerto",
        "ja": "ポート",
        "ms": "Port",
        "pt-br": "Porta",
        "ru": "Порт",
        "ko": "포트",
        "zh-Hant": "埠",
        "zh": "端口",
        "tr": "Bağlantı Noktası",
    },
    "Web UI Port": {
        "en": "Web UI Port",
        "es-es": "Puerto web",
        "ja": "Web UIポート",
        "ms": "Port Web UI",
        "pt-br": "Porta da Web UI",
        "ru": "Порт веб-интерфейса",
        "ko": "웹 UI 포트",
        "zh-Hant": "Web UI 埠",
        "zh": "Web UI 端口",
        "tr": "Web UI Bağlantı Noktası",
    },
    "Password": {
        "en": "Password",
        "es-es": "Contraseña",
        "ja": "パスワード",
        "ms": "Kata laluan",
        "pt-br": "Senha",
        "ru": "Пароль",
        "ko": "비밀번호",
        "zh-Hant": "密碼",
        "zh": "密码",
        "tr": "Parola",
    },
    "API Key": {
        "en": "API Key",
        "es-es": "API Clave",
        "ja": "APIキー",
        "ms": "Kunci API",
        "pt-br": "Chave da API",
        "ru": "API ключ",
        "ko": "API 키",
        "zh-Hant": "API 金鑰",
        "zh": "API Key",
        "tr": "API Anahtarı",
    },
    "Token": {
        "en": "Token",
        "es-es": "Token de acceso",
        "ja": "トークン",
        "ms": "Token",
        "pt-br": "Token",
        "ru": "Токен",
        "ko": "토큰",
        "zh-Hant": "權杖",
        "zh": "令牌",
        "tr": "Belirteç",
    },
    "Base URL": {
        "en": "Base URL",
        "es-es": "Base URL",
        "ja": "Base URL",
        "ms": "Base URL",
        "pt-br": "Base URL",
        "ru": "Base URL",
        "ko": "Base URL",
        "zh-Hant": "Base URL",
        "zh": "Base URL",
        "tr": "Base URL",
    },
}
PLACEHOLDER_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
)


def fail(message: str) -> None:
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(1)


def warn(message: str) -> None:
    print(f"warning: {message}", file=sys.stderr)


def normalize_key(value: str) -> str:
    key = re.sub(r"[^a-z0-9-]+", "-", value.lower()).strip("-")
    key = re.sub(r"-{2,}", "-", key)
    if not KEY_RE.match(key):
        fail(f"invalid app key after normalization: {key!r}")
    if key != value:
        warn(f"normalized app key {value!r} to {key!r}")
    return key


def normalize_version(value: str) -> str:
    version = str(value).strip()
    if version.startswith("v"):
        warn(f"removed leading 'v' from version {version!r}")
        version = version[1:]
    if not version or "/" in version or version in {".", ".."}:
        fail(f"invalid version: {value!r}")
    return version


def scalar(value: Any) -> str:
    if value is None:
        return '""'
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value)
    if text == "":
        return '""'
    safe = re.match(r"^[A-Za-z0-9_./:@%+,-]+$", text)
    special = text.lower() in {"true", "false", "null", "yes", "no", "on", "off"}
    if safe and not special and not text.startswith(("-", "@", "&", "*", "!", "{", "[", "#")):
        return text
    return json.dumps(text, ensure_ascii=False)


def dump_yaml(value: Any, indent: int = 0) -> list[str]:
    pad = " " * indent
    lines: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            if isinstance(item, (dict, list)):
                lines.append(f"{pad}{key}:")
                lines.extend(dump_yaml(item, indent + 2))
            else:
                lines.append(f"{pad}{key}: {scalar(item)}")
    elif isinstance(value, list):
        for item in value:
            if isinstance(item, dict):
                first = True
                for key, subitem in item.items():
                    prefix = "- " if first else "  "
                    if isinstance(subitem, (dict, list)):
                        lines.append(f"{pad}{prefix}{key}:")
                        lines.extend(dump_yaml(subitem, indent + 4))
                    else:
                        lines.append(f"{pad}{prefix}{key}: {scalar(subitem)}")
                    first = False
            elif isinstance(item, list):
                lines.append(f"{pad}-")
                lines.extend(dump_yaml(item, indent + 2))
            else:
                lines.append(f"{pad}- {scalar(item)}")
    else:
        lines.append(f"{pad}{scalar(value)}")
    return lines


def write_yaml(path: Path, value: Any) -> None:
    path.write_text("\n".join(dump_yaml(value)) + "\n", encoding="utf-8")


def normalize_lang_key(key: str) -> str:
    return "zh-Hant" if key.lower() in {"zh-hant", "zh_hant", "zh-tw"} else key


def i18n_map(value: Any, fallback_en: str, fallback_zh: str | None = None) -> dict[str, str]:
    if isinstance(value, dict):
        result = {normalize_lang_key(str(k)): str(v) for k, v in value.items() if v not in (None, "")}
    elif value not in (None, ""):
        text = str(value)
        result = {"en": text, "zh": text}
    else:
        result = {}
    result.setdefault("en", fallback_en)
    result.setdefault("zh", fallback_zh or result["en"])
    result.setdefault("zh-Hant", result["zh"])
    for key in LANG_KEYS:
        result.setdefault(key, result["en"])
    return {key: result[key] for key in LANG_KEYS}


def as_description(value: Any, fallback: str) -> tuple[str, str]:
    if isinstance(value, dict):
        return str(value.get("en") or value.get("zh") or fallback), str(value.get("zh") or value.get("en") or fallback)
    if value:
        return str(value), str(value)
    return fallback, fallback


def label_map(label: str, override: Any = None) -> dict[str, str]:
    if isinstance(override, dict):
        return i18n_map(override, str(override.get("en") or label), str(override.get("zh") or label))
    if label in I18N_LABELS:
        return dict(I18N_LABELS[label])
    return i18n_map({"en": label, "zh": label}, label, label)


def env_vars_from_value(value: Any) -> set[str]:
    if isinstance(value, str):
        return set(VAR_RE.findall(value))
    if isinstance(value, list):
        found: set[str] = set()
        for item in value:
            found.update(env_vars_from_value(item))
        return found
    if isinstance(value, dict):
        found = set()
        for item in value.values():
            found.update(env_vars_from_value(item))
        return found
    return set()


def humanize_env(env_key: str) -> str:
    return env_key.replace("PANEL_APP_PORT_", "").replace("_", " ").title()


def enrich_form_field(field: dict[str, Any]) -> dict[str, Any]:
    result = dict(field)
    label_en = str(result.get("labelEn") or result.get("labelZh") or humanize_env(str(result.get("envKey") or "")))
    label_zh = str(result.get("labelZh") or result.get("labelEn") or label_en)
    translations = label_map(label_en, result.get("label") or {"en": label_en, "zh": label_zh})
    result["labelEn"] = translations["en"]
    result["labelZh"] = translations["zh"]
    result["label"] = translations
    return result


def ensure_form_field(fields: list[dict[str, Any]], field: dict[str, Any]) -> None:
    env_key = field.get("envKey")
    if env_key and not any(existing.get("envKey") == env_key for existing in fields):
        fields.append(field)


def normalize_ports(service: dict[str, Any]) -> list[dict[str, Any]]:
    ports = service.get("ports") or []
    if ports:
        return ports
    if service.get("container_port"):
        return [
            {
                "host_env": service.get("host_port_env") or "PANEL_APP_PORT_HTTP",
                "host_default": service.get("host_port_default") or service.get("container_port"),
                "container": service["container_port"],
            }
        ]
    return []


def port_field(port: dict[str, Any]) -> dict[str, Any]:
    env_key = port.get("host_env") or "PANEL_APP_PORT_HTTP"
    label = port.get("label") or humanize_env(env_key)
    translations = label_map(label, port.get("label_i18n"))
    return {
        "default": int(port.get("host_default") or port.get("container") or 8080),
        "envKey": env_key,
        "labelEn": translations["en"],
        "labelZh": translations["zh"],
        "label": translations,
        "required": True,
        "rule": "paramPort",
        "type": "number",
    }


def env_field(env_key: str, default: Any = "") -> dict[str, Any]:
    translations = label_map(humanize_env(env_key))
    return {
        "default": default,
        "envKey": env_key,
        "labelEn": translations["en"],
        "labelZh": translations["zh"],
        "label": translations,
        "required": True,
        "type": "password" if SECRET_RE.search(env_key) else "text",
    }


def compose_port(port: dict[str, Any]) -> str:
    host_env = port.get("host_env") or "PANEL_APP_PORT_HTTP"
    container = port.get("container")
    if not container:
        fail(f"port {host_env} is missing container port")
    protocol = str(port.get("protocol") or "tcp").lower()
    suffix = "" if protocol == "tcp" else f"/{protocol}"
    return f"${{{host_env}}}:{container}{suffix}"


def service_to_compose(service: dict[str, Any], primary_name: str) -> dict[str, Any]:
    name = service.get("name")
    image = service.get("image")
    if not name or not image:
        fail("every service requires name and image")
    item: dict[str, Any] = {
        "image": image,
        "container_name": "${CONTAINER_NAME}" if name == primary_name else "${CONTAINER_NAME}-" + name,
        "restart": service.get("restart") or "always",
        "networks": ["1panel-network"],
    }
    ports = [compose_port(port) for port in normalize_ports(service)]
    if ports:
        item["ports"] = ports
    for key in ("environment", "volumes", "depends_on", "command", "entrypoint", "healthcheck", "user"):
        if key in service and service[key] not in (None, [], {}):
            item[key] = service[key]
    labels = service.get("labels") or {}
    item["labels"] = {**labels, "createdBy": "Apps"} if isinstance(labels, dict) else [*labels, "createdBy=Apps"]
    return item


def relative_mount_path(volume: str) -> Path | None:
    source = volume.split(":", 1)[0]
    if not source.startswith("./") or ".." in Path(source).parts:
        return None
    return Path(source)


def create_mount_targets(version_dir: Path, services: list[dict[str, Any]]) -> None:
    for service in services:
        for volume in service.get("volumes") or []:
            if not isinstance(volume, str):
                continue
            rel = relative_mount_path(volume)
            if rel is None:
                continue
            target = version_dir / rel
            if target.suffix:
                target.parent.mkdir(parents=True, exist_ok=True)
            else:
                target.mkdir(parents=True, exist_ok=True)
                (target / ".gitkeep").touch()


def normalize_permission_path(value: str) -> str:
    path = str(value).strip()
    if path.startswith("./"):
        path = path[2:]
    item = Path(path)
    if not path or item.is_absolute() or ".." in item.parts or item.parts in {(".",), ()}:
        fail(f"invalid init permission path: {value!r}")
    return str(item)


def collect_permission_fixes(spec: dict[str, Any], services: list[dict[str, Any]]) -> list[dict[str, str]]:
    raw_fixes: list[Any] = []
    raw_fixes.extend(spec.get("init_permissions") or [])
    for service in services:
        raw_fixes.extend(service.get("volume_permissions") or [])
    fixes: list[dict[str, str]] = []
    for raw in raw_fixes:
        path = normalize_permission_path(str(raw.get("path") or ""))
        owner = str(raw.get("owner") or "").strip()
        if not OWNER_RE.match(owner):
            fail(f"init permission for {path!r} requires numeric owner like '1000:1000'")
        fix = {"path": path, "owner": owner}
        mode = raw.get("mode")
        if mode not in (None, ""):
            mode_text = str(mode).strip()
            if not MODE_RE.match(mode_text):
                fail(f"init permission for {path!r} has invalid mode {mode!r}")
            fix["mode"] = mode_text
        if fix not in fixes:
            fixes.append(fix)
    return fixes


def write_init_script(version_dir: Path, spec: dict[str, Any], services: list[dict[str, Any]]) -> None:
    commands = [str(item).rstrip() for item in spec.get("init_commands") or []]
    fixes = collect_permission_fixes(spec, services)
    scripts_dir = version_dir / "scripts"
    if not commands and not fixes:
        if scripts_dir.exists():
            shutil.rmtree(scripts_dir)
        return
    evidence = [str(item).strip() for item in spec.get("init_source_evidence") or [] if str(item).strip()]
    if not evidence:
        fail("init.sh content requires init_source_evidence from official repository or documentation")
    scripts_dir.mkdir(exist_ok=True)
    lines = [
        "#!/bin/bash",
        "",
        "# Generated from official installation evidence:",
        *[f"# - {item}" for item in evidence],
        "",
    ]
    if commands:
        lines.extend(commands)
        lines.append("")
    for fix in fixes:
        path = shlex.quote(fix["path"])
        owner = shlex.quote(fix["owner"])
        lines.append("# Adjust host-mounted data directory permissions for the container runtime user.")
        lines.extend([f"if [ -d {path} ]; then", f"    chown -R {owner} {path}"])
        if "mode" in fix:
            lines.append(f"    chmod -R {shlex.quote(fix['mode'])} {path}")
        lines.extend(["fi", ""])
    init_path = scripts_dir / "init.sh"
    init_path.write_text("\n".join(lines), encoding="utf-8")
    init_path.chmod(0o755)


def copy_logo(spec: dict[str, Any], app_dir: Path) -> None:
    dest = app_dir / "logo.png"
    logo = spec.get("logo")
    if logo:
        src = Path(str(logo)).expanduser()
        if src.exists() and src.is_file() and src.suffix.lower() == ".png":
            shutil.copyfile(src, dest)
            return
        warn("logo is missing or not a PNG; writing placeholder logo.png")
    dest.write_bytes(PLACEHOLDER_PNG)


def build_form_fields(spec: dict[str, Any], services: list[dict[str, Any]]) -> list[dict[str, Any]]:
    fields = [enrich_form_field(field) for field in spec.get("form_fields", [])]
    defaults = spec.get("env_defaults") or {}
    for service in services:
        for port in normalize_ports(service):
            ensure_form_field(fields, port_field(port))
        referenced = set()
        for key in ("environment", "command", "entrypoint"):
            referenced.update(env_vars_from_value(service.get(key)))
        for env_key in sorted(referenced):
            if env_key in BUILTIN_VARS or env_key.startswith("PANEL_APP_PORT_"):
                continue
            ensure_form_field(fields, env_field(env_key, defaults.get(env_key, "")))
    return fields


def root_data(spec: dict[str, Any], key: str, name: str) -> dict[str, Any]:
    desc_en, desc_zh = as_description(spec.get("description"), name)
    tags = spec.get("tags") or ["Tool"]
    props: dict[str, Any] = {
        "key": key,
        "name": name,
        "tags": tags,
        "shortDescZh": spec.get("shortDescZh") or desc_zh,
        "shortDescEn": spec.get("shortDescEn") or desc_en,
        "description": i18n_map(spec.get("description"), desc_en, desc_zh),
        "type": spec.get("type") or "tool",
        "crossVersionUpdate": bool(spec.get("crossVersionUpdate", True)),
        "limit": int(spec.get("limit", 0)),
        "architectures": spec.get("architectures") or ["amd64"],
    }
    for field in ("recommend", "website", "github", "document", "memoryRequired"):
        if field in spec and spec[field] not in (None, ""):
            props[field] = spec[field]
    return {"name": name, "tags": tags, "title": spec.get("title") or name, "description": desc_zh, "additionalProperties": props}


def readme_profile(spec: dict[str, Any], lang: str, name: str) -> tuple[str, list[dict[str, str]]]:
    readme = spec.get("readme") or {}
    localized = readme.get(lang) if isinstance(readme, dict) else {}
    if isinstance(localized, dict) and localized.get("introduction"):
        features = []
        for feature in localized.get("features") or []:
            if isinstance(feature, dict) and feature.get("title") and feature.get("description"):
                features.append({"title": str(feature["title"]), "description": str(feature["description"])})
        return str(localized["introduction"]), features
    desc_en, desc_zh = as_description(spec.get("description"), name)
    return (desc_zh if lang == "zh" else desc_en), []


def readme_text(spec: dict[str, Any], name: str, lang: str) -> str:
    intro, features = readme_profile(spec, lang, name)
    if lang == "zh":
        lines = ["## 产品介绍", "", f"**{name}** {intro}", ""]
        if features:
            lines.extend(["## 主要功能", ""])
            lines.extend(f"- **{item['title']}**：{item['description']}" for item in features)
    else:
        lines = ["## Introduction", "", f"**{name}** {intro}", ""]
        if features:
            lines.extend(["## Features", ""])
            lines.extend(f"- **{item['title']}**: {item['description']}" for item in features)
    return "\n".join(lines).rstrip() + "\n"


def generate(spec: dict[str, Any], output: Path, force: bool) -> Path:
    key = normalize_key(str(spec.get("key") or spec.get("name") or ""))
    name = str(spec.get("name") or key)
    version = normalize_version(str(spec.get("version") or ""))
    services = spec.get("services") or []
    if not isinstance(services, list) or not services:
        fail("spec.services must contain at least one service")
    primary = next((svc for svc in services if svc.get("primary")), services[0])
    primary_name = primary.get("name")
    if not primary_name:
        fail("primary service requires a name")

    app_dir = output / key
    version_dir = app_dir / version
    if app_dir.exists() and not force:
        fail(f"{app_dir} already exists; pass --force to overwrite generated files")
    app_dir.mkdir(parents=True, exist_ok=True)
    version_dir.mkdir(parents=True, exist_ok=True)

    write_yaml(app_dir / "data.yml", root_data(spec, key, name))
    write_yaml(version_dir / "data.yml", {"additionalProperties": {"formFields": build_form_fields(spec, services)}})
    write_yaml(
        version_dir / "docker-compose.yml",
        {
            "services": {svc["name"]: service_to_compose(svc, primary_name) for svc in services},
            "networks": {"1panel-network": {"external": True}},
        },
    )
    create_mount_targets(version_dir, services)
    write_init_script(version_dir, spec, services)
    (app_dir / "README.md").write_text(readme_text(spec, name, "zh"), encoding="utf-8")
    if spec.get("english_supported", True):
        (app_dir / "README_en.md").write_text(readme_text(spec, name, "en"), encoding="utf-8")
    copy_logo(spec, app_dir)
    return app_dir


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", required=True, help="Path to JSON app spec")
    parser.add_argument("--output", required=True, help="Output directory, usually the repo apps/ directory")
    parser.add_argument("--force", action="store_true", help="Overwrite an existing generated app directory")
    args = parser.parse_args()
    spec_path = Path(args.spec)
    if not spec_path.exists():
        fail(f"spec file not found: {spec_path}")
    app_dir = generate(json.loads(spec_path.read_text(encoding="utf-8")), Path(args.output), args.force)
    print(app_dir)


if __name__ == "__main__":
    main()
