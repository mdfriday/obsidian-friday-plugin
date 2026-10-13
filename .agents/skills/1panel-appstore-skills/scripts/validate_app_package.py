#!/usr/bin/env python3
"""Validate a generated 1Panel appstore package."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


VAR_RE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}")
ENVKEY_RE = re.compile(r"envKey:\s*['\"]?([A-Za-z_][A-Za-z0-9_]*)['\"]?")
BUILTIN_VARS = {"CONTAINER_NAME", "HOST_IP", "HOST_ADDRESS"}
LANG_KEYS = ["en", "es-es", "ja", "ms", "pt-br", "ru", "ko", "zh-Hant", "zh", "tr"]
RISKY_PATTERNS = {
    "privileged: true": "privileged containers require explicit review",
    "network_mode: host": "host networking should be avoided unless required",
    "pid: host": "host PID namespace should be avoided",
    "/var/run/docker.sock": "docker socket mount is high risk",
    "- /:/": "root filesystem mount is high risk",
    "- /etc:": "host /etc mount is high risk",
}


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def line_has_after(text: str, anchor: str, pattern: str, window: int = 10) -> bool:
    lines = text.splitlines()
    for idx, line in enumerate(lines):
        if anchor in line:
            return re.search(pattern, "\n".join(lines[idx : idx + window])) is not None
    return False


def block_has_languages(text: str, anchor: str, window: int = 16) -> list[str]:
    lines = text.splitlines()
    for idx, line in enumerate(lines):
        if re.match(anchor, line):
            chunk = "\n".join(lines[idx : idx + window])
            return [key for key in LANG_KEYS if not re.search(rf"^\s+{re.escape(key)}:\s+", chunk, re.M)]
    return LANG_KEYS


def label_blocks_missing_languages(text: str) -> list[str]:
    lines = text.splitlines()
    problems: list[str] = []
    for idx, line in enumerate(lines):
        if re.match(r"^\s+label:\s*$", line):
            chunk = "\n".join(lines[idx : idx + 16])
            missing = [key for key in LANG_KEYS if not re.search(rf"^\s+{re.escape(key)}:\s+", chunk, re.M)]
            if missing:
                problems.append(", ".join(missing))
    return problems


def validate(app_dir: Path) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    app_key = app_dir.name

    for rel in ("data.yml", "README.md", "logo.png"):
        if not (app_dir / rel).exists():
            errors.append(f"missing root file: {rel}")
    if not (app_dir / "README_en.md").exists():
        warnings.append("missing root file: README_en.md; generate it when the app or upstream docs support English")

    root_data = read(app_dir / "data.yml") if (app_dir / "data.yml").exists() else ""
    readme = read(app_dir / "README.md") if (app_dir / "README.md").exists() else ""
    readme_en = read(app_dir / "README_en.md") if (app_dir / "README_en.md").exists() else ""
    if readme and "## 产品介绍" not in readme:
        errors.append("README.md should follow appstore style and include ## 产品介绍")
    if readme_en and "## Introduction" not in readme_en:
        errors.append("README_en.md should follow appstore style and include ## Introduction")
    for marker in ("Source Evidence", "Local Test", "generated for 1Panel local app testing"):
        if marker in readme or marker in readme_en:
            warnings.append(f"README files should not include generated-package note: {marker}")
    if root_data:
        for token in ("additionalProperties:", "key:", "name:", "tags:", "description:", "type:", "limit:"):
            if token not in root_data:
                errors.append(f"root data.yml missing {token}")
        if not re.search(rf"key:\s*['\"]?{re.escape(app_key)}['\"]?$", root_data, re.M):
            errors.append(f"root data.yml key must match folder name {app_key!r}")
        missing_desc = block_has_languages(root_data, r"^\s+description:\s*$")
        if missing_desc:
            errors.append(f"root data.yml description missing languages: {', '.join(missing_desc)}")

    version_dirs = sorted(item for item in app_dir.iterdir() if item.is_dir() and (item / "docker-compose.yml").exists())
    if not version_dirs:
        errors.append("no version directory with docker-compose.yml found")
        return errors, warnings

    for version_dir in version_dirs:
        version = version_dir.name
        if version.startswith("v"):
            errors.append(f"version directory must not start with 'v': {version}")
        version_data_path = version_dir / "data.yml"
        compose_path = version_dir / "docker-compose.yml"
        if not version_data_path.exists():
            errors.append(f"{version}/data.yml is missing")
            continue
        version_data = read(version_data_path)
        compose = read(compose_path)

        if "additionalProperties:" not in version_data or "formFields:" not in version_data:
            errors.append(f"{version}/data.yml must contain additionalProperties.formFields")
        for missing in label_blocks_missing_languages(version_data):
            errors.append(f"{version}/data.yml label missing languages: {missing}")

        for token, message in {
            "services:": "compose must define services",
            "1panel-network": "compose must use 1panel-network",
            "external: true": "1panel-network must be external",
            "createdBy": "services must include createdBy label",
        }.items():
            if token not in compose:
                errors.append(f"{version}/docker-compose.yml: {message}")
        if "${CONTAINER_NAME}" not in compose:
            errors.append(f"{version}/docker-compose.yml: primary service should use ${{CONTAINER_NAME}}")

        declared = set(ENVKEY_RE.findall(version_data))
        variables = set(VAR_RE.findall(compose))
        allow = set(BUILTIN_VARS)
        if {"PANEL_DB_HOST", "PANEL_DB_TYPE"} & declared:
            allow.add("PANEL_DB_PORT")
        for variable in sorted(variables - allow):
            if variable not in declared:
                errors.append(f"{version}: compose variable ${{{variable}}} is not declared in data.yml")

        for env_key in sorted(declared):
            if env_key.startswith("PANEL_APP_PORT_"):
                if not line_has_after(version_data, f"envKey: {env_key}", r"rule:\s*paramPort", window=28):
                    errors.append(f"{version}: {env_key} should use rule: paramPort")
                if not line_has_after(version_data, f"envKey: {env_key}", r"type:\s*number", window=28):
                    errors.append(f"{version}: {env_key} should use type: number")

        for pattern, message in RISKY_PATTERNS.items():
            if pattern in compose:
                warnings.append(f"{version}/docker-compose.yml: {message} ({pattern})")
        for image in re.findall(r"image:\s*['\"]?([^'\"\s]+)", compose):
            if image.endswith(":latest") or ":" not in image.split("/")[-1]:
                warnings.append(f"{version}/docker-compose.yml: image is floating or untagged: {image}")

        scripts_dir = version_dir / "scripts"
        if scripts_dir.exists():
            script_files = [item for item in scripts_dir.iterdir() if item.is_file()]
            if not script_files:
                errors.append(f"{version}/scripts exists but contains no scripts")
            init_path = scripts_dir / "init.sh"
            if init_path.exists() and "Generated from official installation evidence:" not in read(init_path):
                warnings.append(f"{version}/scripts/init.sh should document official source evidence")

    return errors, warnings


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app_dir", help="Path to apps/<app-key>")
    args = parser.parse_args()
    app_dir = Path(args.app_dir)
    if not app_dir.exists() or not app_dir.is_dir():
        print(f"error: app directory not found: {app_dir}")
        raise SystemExit(1)
    errors, warnings = validate(app_dir)
    for warning in warnings:
        print(f"warning: {warning}")
    for error in errors:
        print(f"error: {error}")
    if errors:
        raise SystemExit(1)
    print(f"OK: {app_dir}")


if __name__ == "__main__":
    main()
